# shellVerbsWorker.ps1 — 상주 셸 verb 워커 (§Y1 · ADR-013 · ADR-005)
#
# stdin/stdout JSON 라인 프로토콜(1요청 = JSON 1줄 → 1응답 = JSON 1줄).
# 경로·verbId 는 stdin JSON 본문($req.paths / $req.verbId)으로만 사용한다 —
# 명령행/스크립트 문자열 합성 0(ADR-005 §3.3-4 · showProperties 선례 동치).
# 블랙리스트는 ps1 이 아니라 Main(shellVerbsBlacklist.ts)에서 적용한다(언어 사전 단일 출처).
#
# 단일 선택(paths.Count = 1): COM Shell.Application 의 FolderItem.Verbs() 사용(검증된 기존 경로).
# 다중 선택(paths.Count > 1): Shell IShellFolder::GetUIObjectOf → IContextMenu(다중 PIDL)로
#   선택 전체를 하나의 컨텍스트 메뉴로 처리(압축·보내기 등이 묶여서 동작). C# Add-Type 으로
#   COM 인터페이스를 P/Invoke 한다. 컴파일 실패 시 다중만 빈 목록으로 폴백(단일은 영향 없음).
#
# 요청: { "id":"<id>", "op":"list"|"invoke"|"ping", "paths":["<절대경로>", ...], "verbId"?:"<index>:<display>" }
# 응답(list)  : { "id", "ok":true, "verbs":[ { "index":N, "name":"<원문>", "display":"<&제거>" }, ... ] }
# 응답(invoke): { "id", "ok":true }  /  { "id", "ok":false, "code":"EVERB"|"ENOENT"|"EUNKNOWN" }
# 응답(ping)  : { "id", "ok":true }

$ErrorActionPreference = 'Stop'
# 인코딩 — 권고① 흡수: stdout/stdin 모두 UTF-8(PS 5.1 한글 표시명/경로 깨짐 방지).
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { [Console]::InputEncoding = [Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [Text.Encoding]::UTF8

# COM Shell.Application 1회 생성(상주 — 매 요청 재생성 비용 회피). 단일 선택 경로용.
$shell = $null
try { $shell = New-Object -ComObject Shell.Application } catch { $shell = $null }

# ── 다중 선택용 C# 셸 컨텍스트 메뉴 헬퍼(IShellFolder/IContextMenu P/Invoke) ──
# Add-Type 컴파일 실패(잠긴 temp 등)는 $canMulti=$false 로 흡수 — 다중만 빈 목록 폴백,
# 단일(COM) 경로는 영향 없음. STA 아파트(powershell.exe 기본)에서 셸 COM 호출.
$canMulti = $true
try {
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ShellCtxMenu {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  struct MENUITEMINFO {
    public int cbSize; public int fMask; public int fType; public int fState; public int wID;
    public IntPtr hSubMenu; public IntPtr hbmpChecked; public IntPtr hbmpUnchecked;
    public IntPtr dwItemData; public IntPtr dwTypeData; public int cch; public IntPtr hbmpItem;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  struct CMINVOKECOMMANDINFO {
    public int cbSize; public int fMask; public IntPtr hwnd; public IntPtr lpVerb;
    [MarshalAs(UnmanagedType.LPStr)] public string lpParameters;
    [MarshalAs(UnmanagedType.LPStr)] public string lpDirectory;
    public int nShow; public int dwHotKey; public IntPtr hIcon;
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214E6-0000-0000-C000-000000000046")]
  interface IShellFolder {
    [PreserveSig] int ParseDisplayName(IntPtr hwnd, IntPtr pbc, [MarshalAs(UnmanagedType.LPWStr)] string n, out uint eaten, out IntPtr ppidl, ref uint attr);
    [PreserveSig] int EnumObjects(IntPtr hwnd, int flags, out IntPtr ppenum);
    [PreserveSig] int BindToObject(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int BindToStorage(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int CompareIDs(IntPtr lParam, IntPtr p1, IntPtr p2);
    [PreserveSig] int CreateViewObject(IntPtr hwnd, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int GetAttributesOf(uint cidl, [In] IntPtr[] apidl, ref uint inout);
    [PreserveSig] int GetUIObjectOf(IntPtr hwnd, uint cidl, IntPtr apidl, ref Guid riid, IntPtr res, out IntPtr ppv);
    [PreserveSig] int GetDisplayNameOf(IntPtr pidl, uint flags, IntPtr name);
    [PreserveSig] int SetNameOf(IntPtr hwnd, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string n, uint flags, out IntPtr ppidl);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214E4-0000-0000-C000-000000000046")]
  interface IContextMenu {
    [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, int idFirst, int idLast, uint flags);
    [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFO ici);
    [PreserveSig] int GetCommandString(IntPtr idCmd, uint type, IntPtr res, IntPtr commandString, int max);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr ILCreateFromPath(string path);
  [DllImport("shell32.dll")] static extern void ILFree(IntPtr pidl);
  [DllImport("shell32.dll")] static extern IntPtr ILClone(IntPtr pidl);
  [DllImport("shell32.dll")] static extern bool ILRemoveLastID(IntPtr pidl);
  [DllImport("shell32.dll")] static extern IntPtr ILFindLastID(IntPtr pidl);
  [DllImport("shell32.dll")] static extern int SHGetDesktopFolder(out IntPtr ppshf);
  [DllImport("user32.dll")] static extern IntPtr CreatePopupMenu();
  [DllImport("user32.dll")] static extern bool DestroyMenu(IntPtr hmenu);
  [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr hmenu);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern bool GetMenuItemInfo(IntPtr hmenu, uint item, bool byPos, ref MENUITEMINFO mii);
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();

  static Guid IID_IShellFolder = new Guid("000214E6-0000-0000-C000-000000000046");
  static Guid IID_IContextMenu = new Guid("000214E4-0000-0000-C000-000000000046");

  const int MIIM_ID = 2, MIIM_SUBMENU = 4, MIIM_STRING = 0x40, MIIM_FTYPE = 0x100;
  const int MFT_SEPARATOR = 0x800;
  const int CMF_NORMAL = 0;
  const int IDFIRST = 1, IDLAST = 0x7FFF;

  public struct Verb { public int Index; public string Name; public string Display; }

  // 선택 경로들(같은 부모 폴더)의 IContextMenu 구성. abs(절대 PIDL 배열)은 호출자가 해제.
  static IContextMenu Build(string[] paths, out IShellFolder parent, out IntPtr[] abs) {
    parent = null; abs = new IntPtr[paths.Length];
    IntPtr deskPtr;
    if (SHGetDesktopFolder(out deskPtr) != 0 || deskPtr == IntPtr.Zero) return null;
    IShellFolder desktop = (IShellFolder)Marshal.GetObjectForIUnknown(deskPtr);
    try {
      for (int i = 0; i < paths.Length; i++) {
        abs[i] = ILCreateFromPath(paths[i]);
        if (abs[i] == IntPtr.Zero) return null;
      }
      IntPtr parentPidl = ILClone(abs[0]);
      ILRemoveLastID(parentPidl);
      IntPtr parentPtr;
      int hr = desktop.BindToObject(parentPidl, IntPtr.Zero, ref IID_IShellFolder, out parentPtr);
      ILFree(parentPidl);
      if (hr != 0 || parentPtr == IntPtr.Zero) return null;
      parent = (IShellFolder)Marshal.GetObjectForIUnknown(parentPtr);
      Marshal.Release(parentPtr);
      // apidl 은 비관리 IntPtr 배열로 직접 마샬링한다([In] IntPtr[] 기본 마샬링은 이 STA/COM
      // PreserveSig 경로에서 AccessViolation 을 일으킴 — 실측 확인). 각 child 는 abs 내부 포인터.
      IntPtr arr = Marshal.AllocHGlobal(IntPtr.Size * paths.Length);
      try {
        for (int i = 0; i < paths.Length; i++) Marshal.WriteIntPtr(arr, i * IntPtr.Size, ILFindLastID(abs[i]));
        IntPtr cmPtr;
        hr = parent.GetUIObjectOf(GetDesktopWindow(), (uint)paths.Length, arr, ref IID_IContextMenu, IntPtr.Zero, out cmPtr);
        if (hr != 0 || cmPtr == IntPtr.Zero) return null;
        IContextMenu cm = (IContextMenu)Marshal.GetObjectForIUnknown(cmPtr);
        Marshal.Release(cmPtr);
        return cm;
      } finally {
        Marshal.FreeHGlobal(arr);
      }
    } finally {
      Marshal.ReleaseComObject(desktop);
    }
  }

  static string ItemText(IntPtr hmenu, int pos, out int wID, out int fType, out IntPtr hSub) {
    MENUITEMINFO mii = new MENUITEMINFO();
    mii.cbSize = Marshal.SizeOf(typeof(MENUITEMINFO));
    mii.fMask = MIIM_ID | MIIM_FTYPE | MIIM_SUBMENU | MIIM_STRING;
    wID = 0; fType = 0; hSub = IntPtr.Zero;
    if (!GetMenuItemInfo(hmenu, (uint)pos, true, ref mii)) return null;
    wID = mii.wID; fType = mii.fType; hSub = mii.hSubMenu;
    if ((mii.fType & MFT_SEPARATOR) != 0) return null;
    int cch = mii.cch + 1;
    IntPtr buf = Marshal.AllocHGlobal(cch * 2);
    try {
      MENUITEMINFO m2 = new MENUITEMINFO();
      m2.cbSize = Marshal.SizeOf(typeof(MENUITEMINFO));
      m2.fMask = MIIM_STRING; m2.dwTypeData = buf; m2.cch = cch;
      if (!GetMenuItemInfo(hmenu, (uint)pos, true, ref m2)) return null;
      return Marshal.PtrToStringAuto(buf);
    } finally { Marshal.FreeHGlobal(buf); }
  }

  // 다중 선택 verb 열거(top-level·비-separator·비-submenu·텍스트 있음). index=명령 오프셋(wID-1).
  public static Verb[] List(string[] paths) {
    IShellFolder parent; IntPtr[] abs;
    IContextMenu cm = Build(paths, out parent, out abs);
    var res = new List<Verb>();
    IntPtr hmenu = IntPtr.Zero;
    try {
      if (cm == null) return res.ToArray();
      hmenu = CreatePopupMenu();
      cm.QueryContextMenu(hmenu, 0, IDFIRST, IDLAST, CMF_NORMAL);
      int count = GetMenuItemCount(hmenu);
      for (int pos = 0; pos < count; pos++) {
        int wID, fType; IntPtr hSub;
        string text = ItemText(hmenu, pos, out wID, out fType, out hSub);
        if (text == null) continue;
        if (hSub != IntPtr.Zero) continue;              // 하위 메뉴(팝업) 제외 — Verbs() 평탄 목록 동치.
        if (wID < IDFIRST || wID > IDLAST) continue;
        if (text.Length == 0) continue;
        res.Add(new Verb { Index = wID - IDFIRST, Name = text, Display = text.Replace("&", "") });
      }
    } finally {
      if (hmenu != IntPtr.Zero) DestroyMenu(hmenu);
      if (cm != null) Marshal.ReleaseComObject(cm);
      if (parent != null) Marshal.ReleaseComObject(parent);
      if (abs != null) foreach (var p in abs) if (p != IntPtr.Zero) ILFree(p);
    }
    return res.ToArray();
  }

  // 다중 선택 verb 실행. 반환: 0=ok · 1=EVERB(미존재/표시명 불일치) · 2=ENOENT(메뉴 구성 실패) · 3=EUNKNOWN.
  public static int Invoke(string[] paths, int cmdOffset, string wantDisplay) {
    IShellFolder parent; IntPtr[] abs;
    IContextMenu cm = Build(paths, out parent, out abs);
    IntPtr hmenu = IntPtr.Zero;
    try {
      if (cm == null) return 2;
      hmenu = CreatePopupMenu();
      cm.QueryContextMenu(hmenu, 0, IDFIRST, IDLAST, CMF_NORMAL);
      int count = GetMenuItemCount(hmenu);
      bool found = false;
      for (int pos = 0; pos < count; pos++) {
        int wID, fType; IntPtr hSub;
        string text = ItemText(hmenu, pos, out wID, out fType, out hSub);
        if (text == null || hSub != IntPtr.Zero) continue;
        if (wID - IDFIRST != cmdOffset) continue;
        if (text.Replace("&", "") != wantDisplay) return 1; // 스테일 메뉴 교차검증(오실행 방지).
        found = true; break;
      }
      if (!found) return 1;
      CMINVOKECOMMANDINFO ici = new CMINVOKECOMMANDINFO();
      ici.cbSize = Marshal.SizeOf(typeof(CMINVOKECOMMANDINFO));
      ici.hwnd = GetDesktopWindow();
      ici.lpVerb = (IntPtr)cmdOffset; // MAKEINTRESOURCE(명령 오프셋).
      ici.nShow = 1;                  // SW_SHOWNORMAL.
      int hr = cm.InvokeCommand(ref ici);
      return hr == 0 ? 0 : 3;
    } finally {
      if (hmenu != IntPtr.Zero) DestroyMenu(hmenu);
      if (cm != null) Marshal.ReleaseComObject(cm);
      if (parent != null) Marshal.ReleaseComObject(parent);
      if (abs != null) foreach (var p in abs) if (p != IntPtr.Zero) ILFree(p);
    }
  }
}
'@
} catch { $canMulti = $false }

function Get-ShellItem([string]$fullPath) {
  if ($null -eq $shell) { return $null }
  # [IO.Path] 사용(Split-Path 매개변수 집합 모호성 회피·로케일 무관). 경로는 stdin 본문.
  $dir = [System.IO.Path]::GetDirectoryName($fullPath)
  $leaf = [System.IO.Path]::GetFileName($fullPath)
  if ([string]::IsNullOrEmpty($dir) -or [string]::IsNullOrEmpty($leaf)) { return $null }
  $folder = $shell.NameSpace($dir)
  if ($null -eq $folder) { return $null }
  return $folder.ParseName($leaf)
}

# JSON 1줄 출력 + 즉시 flush.
function Write-Line($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

# 요청 본문에서 대상 경로 배열을 안정적으로 얻는다(paths 우선·없으면 단일 path 래핑).
function Get-ReqPaths($req) {
  $paths = @()
  if ($null -ne $req.paths) { $paths = @($req.paths) }
  elseif ($null -ne $req.path) { $paths = @($req.path) }
  return @($paths | Where-Object { -not [string]::IsNullOrEmpty($_) } | ForEach-Object { [string]$_ })
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $op = $req.op

    if ($op -eq 'ping') {
      Write-Line @{ id = $id; ok = $true }
      continue
    }

    if ($op -eq 'list') {
      # @(...) 강제: PowerShell 은 함수가 반환한 단일 원소 배열을 스칼라로 언랩하므로
      # 재배열화해야 $paths[0] 가 경로 문자열(단일은 그 1개)을 가리킨다(문자 인덱싱 방지).
      $paths = @(Get-ReqPaths $req)
      if ($paths.Count -eq 0) {
        Write-Line @{ id = $id; ok = $false; code = 'ENOENT' }
        continue
      }

      # ── 다중 선택: IContextMenu(선택 전체를 하나로) ──
      if ($paths.Count -gt 1) {
        if (-not $canMulti) { Write-Line @{ id = $id; ok = $true; verbs = @() }; continue }
        $verbs = @()
        foreach ($v in [ShellCtxMenu]::List($paths)) {
          $verbs += @{ index = $v.Index; name = $v.Name; display = $v.Display }
        }
        Write-Line @{ id = $id; ok = $true; verbs = @($verbs) }
        continue
      }

      # ── 단일 선택: COM Shell.Application Verbs()(검증된 기존 경로) ──
      $item = Get-ShellItem $paths[0]
      if ($null -eq $item) {
        Write-Line @{ id = $id; ok = $false; code = 'ENOENT' }
        continue
      }
      $verbs = @()
      $i = 0
      foreach ($v in $item.Verbs()) {
        $name = $v.Name
        if (-not [string]::IsNullOrEmpty($name)) {
          $verbs += @{ index = $i; name = $name; display = ($name -replace '&', '') }
        }
        $i++
      }
      # @($verbs) 강제로 단일 원소도 배열 유지(ConvertTo-Json 객체화 방지).
      Write-Line @{ id = $id; ok = $true; verbs = @($verbs) }
      continue
    }

    if ($op -eq 'invoke') {
      # @(...) 강제: 단일 원소 배열 언랩 방지(list 와 동일 — 문자 인덱싱 방지).
      $paths = @(Get-ReqPaths $req)
      if ($paths.Count -eq 0) {
        Write-Line @{ id = $id; ok = $false; code = 'ENOENT' }
        continue
      }
      # verbId = "<index>:<display>" — 첫 콜론까지 index, 나머지 display.
      $verbId = [string]$req.verbId
      $colon = $verbId.IndexOf(':')
      if ($colon -lt 0) {
        Write-Line @{ id = $id; ok = $false; code = 'EVERB' }
        continue
      }
      $wantIndex = -1
      [void][int]::TryParse($verbId.Substring(0, $colon), [ref]$wantIndex)
      $wantDisplay = $verbId.Substring($colon + 1)

      # ── 다중 선택: IContextMenu::InvokeCommand(명령 오프셋·표시명 교차검증) ──
      if ($paths.Count -gt 1) {
        if (-not $canMulti) { Write-Line @{ id = $id; ok = $false; code = 'EUNKNOWN' }; continue }
        $rc = [ShellCtxMenu]::Invoke($paths, $wantIndex, $wantDisplay)
        if ($rc -eq 0) { Write-Line @{ id = $id; ok = $true } }
        elseif ($rc -eq 1) { Write-Line @{ id = $id; ok = $false; code = 'EVERB' } }
        elseif ($rc -eq 2) { Write-Line @{ id = $id; ok = $false; code = 'ENOENT' } }
        else { Write-Line @{ id = $id; ok = $false; code = 'EUNKNOWN' } }
        continue
      }

      # ── 단일 선택: COM Verbs().DoIt()(검증된 기존 경로) ──
      $item = Get-ShellItem $paths[0]
      if ($null -eq $item) {
        Write-Line @{ id = $id; ok = $false; code = 'ENOENT' }
        continue
      }

      # 재열거 후 교차검증(스테일 메뉴로 오실행 방지 — ADR-013 결정③).
      $list = @()
      $j = 0
      foreach ($v in $item.Verbs()) {
        $list += @{ index = $j; verb = $v; display = ($v.Name -replace '&', '') }
        $j++
      }

      $chosen = $null
      # ① index 위치의 정규화 display 가 요청 display 와 일치 → 그 verb(빠른 경로 + 교차검증).
      if ($wantIndex -ge 0 -and $wantIndex -lt $list.Count) {
        if ($list[$wantIndex].display -eq $wantDisplay) {
          $chosen = $list[$wantIndex].verb
        }
      }
      # ② 불일치 → 전체에서 정규화 display 일치 첫 verb(표시명 매칭 폴백).
      if ($null -eq $chosen) {
        foreach ($e in $list) {
          if ($e.display -eq $wantDisplay) { $chosen = $e.verb; break }
        }
      }
      # ③ 없음 → 실행하지 않고 EVERB(오실행 < 미실행).
      if ($null -eq $chosen) {
        Write-Line @{ id = $id; ok = $false; code = 'EVERB' }
        continue
      }

      $chosen.DoIt()
      Write-Line @{ id = $id; ok = $true }
      continue
    }

    # 미지의 op.
    Write-Line @{ id = $id; ok = $false; code = 'EUNKNOWN'; message = 'unknown op' }
  }
  catch {
    $msg = $_.Exception.Message
    Write-Line @{ id = $id; ok = $false; code = 'EUNKNOWN'; message = $msg }
  }
}
