#Requires -Version 7.0
param(
 [ValidateSet('Status','TogglePause','Reset')][string]$Action='Status',
 [ValidateRange(0,15)][int]$DelaySeconds=5,
 [switch]$DryRun
)

function Initialize-KvkChallengeNative {
 if('AimloomChallenge.NativeInput' -as [type]){return}
 Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
namespace AimloomChallenge {
 [StructLayout(LayoutKind.Sequential)] public struct KeyboardInput {
  public ushort wVk,wScan; public uint dwFlags,time; public UIntPtr extra;
 }
 [StructLayout(LayoutKind.Sequential)] public struct MouseInput {
  public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr extra;
 }
 [StructLayout(LayoutKind.Sequential)] public struct HardwareInput {
  public uint message; public ushort low,high;
 }
 [StructLayout(LayoutKind.Explicit)] public struct InputData {
  [FieldOffset(0)] public KeyboardInput keyboard;
  [FieldOffset(0)] public MouseInput mouse;
  [FieldOffset(0)] public HardwareInput hardware;
 }
 [StructLayout(LayoutKind.Sequential)] public struct Input {
  public uint type; public InputData data;
 }
 public static class NativeInput {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll",SetLastError=true)] private static extern uint SendInput(uint count,Input[] inputs,int size);
  public static int InputSize { get { return Marshal.SizeOf(typeof(Input)); } }
  public static bool IsHeld(int key) { return (GetAsyncKeyState(key)&0x8000)!=0; }
  public static Input[] BuildStroke(ushort key) {
   if(key!=27 && key!=32) throw new ArgumentOutOfRangeException("key");
   var down=new Input {type=1};down.data.keyboard.wVk=key;
   var up=down;up.data.keyboard.dwFlags=2;
   return new [] {down,up};
  }
  public static uint SendStroke(IntPtr expectedWindow,int expectedProcessId,ushort key) {
   if(expectedWindow==IntPtr.Zero || expectedProcessId<=0) throw new InvalidOperationException("Missing game target");
   int session=Process.GetCurrentProcess().SessionId;
   if(session==0) throw new InvalidOperationException("Interactive desktop required");
   uint actualId;
   if(GetForegroundWindow()!=expectedWindow || GetWindowThreadProcessId(expectedWindow,out actualId)==0 || actualId!=(uint)expectedProcessId)
    throw new InvalidOperationException("Foreground window changed");
   using(var process=Process.GetProcessById(expectedProcessId)) {
    if(process.SessionId!=session || (process.ProcessName!="FPSAimTrainer" && process.ProcessName!="FPSAimTrainer-Win64-Shipping"))
     throw new InvalidOperationException("Foreground process is not this session's game");
   }
   foreach(int held in new [] {16,17,18,91,92,27,32})
    if(IsHeld(held)) throw new InvalidOperationException("Release held keys before sending a challenge command");
   // One down/up batch, no automatic retry: Escape is a toggle, not an idempotent command.
   return SendInput(2,BuildStroke(key),InputSize);
  }
 }
}
'@ -ErrorAction Stop
}

function Get-KvkChallengeContext {
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw '挑战按键辅助脚本只能在 Windows 运行'}
 Initialize-KvkChallengeNative
 $session=[Diagnostics.Process]::GetCurrentProcess().SessionId
 $context=[ordered]@{sessionId=$session;window=[intptr]::Zero;processId=0;processName='';targetSessionId=$null;heldKeys=@()}
 if($session -eq 0){return [pscustomobject]$context}
 $window=[AimloomChallenge.NativeInput]::GetForegroundWindow()
 if($window -eq [intptr]::Zero){return [pscustomobject]$context}
 [uint32]$targetId=0
 $thread=[AimloomChallenge.NativeInput]::GetWindowThreadProcessId($window,[ref]$targetId)
 if($thread -eq 0 -or $targetId -eq 0){return [pscustomobject]$context}
 $process=[Diagnostics.Process]::GetProcessById([int]$targetId)
 try {
  $context.window=$window;$context.processId=[int]$targetId;$context.processName=$process.ProcessName;$context.targetSessionId=$process.SessionId
 } finally {$process.Dispose()}
 $context.heldKeys=@(16,17,18,91,92,27,32|Where-Object{[AimloomChallenge.NativeInput]::IsHeld($_)})
 return [pscustomobject]$context
}

function Send-KvkChallengeStroke($Context,[int]$VirtualKey) {
 return [AimloomChallenge.NativeInput]::SendStroke($Context.window,$Context.processId,[ushort]$VirtualKey)
}

function Invoke-KvkChallengeControl {
 param(
  [ValidateSet('Status','TogglePause','Reset')][string]$Action='Status',
  [ValidateRange(0,15)][int]$DelaySeconds=5,
  [switch]$DryRun
 )
 $context=Get-KvkChallengeContext
 if($Action -eq 'Status'){
  return [pscustomobject]@{status='status-only';challengeState='unknown';context=$context}
 }
 if($context.sessionId -le 0){throw '需要在 Windows 已登录桌面运行；SSH Session 0 不能直接向游戏发送按键'}
 if($DelaySeconds -gt 0){Write-Host "请在 $DelaySeconds 秒内切回 KovaaK 挑战界面，并松开 Alt、Ctrl 等按键";Start-Sleep -Seconds $DelaySeconds}
 $context=Get-KvkChallengeContext
 if($context.sessionId -le 0 -or $context.targetSessionId -ne $context.sessionId){throw '游戏窗口必须位于当前交互式桌面会话'}
 if($context.window -eq [intptr]::Zero -or $context.processName -notin @('FPSAimTrainer','FPSAimTrainer-Win64-Shipping')){throw '前台窗口不是 KovaaK，未发送按键'}
 if(@($context.heldKeys).Count -gt 0){throw '请先松开修饰键、Esc 和空格，再重新执行'}
 $key=if($Action -eq 'TogglePause'){27}else{32}
 $keyName=if($Action -eq 'TogglePause'){'Esc'}else{'Space'}
 if($DryRun){return [pscustomobject]@{status='dry-run';action=$Action;key=$keyName;challengeState='unknown'}}
 $sent=Send-KvkChallengeStroke $context $key
 if($sent -ne 2){throw '按键未完整发送，结果未知；请检查游戏和键盘状态。为避免重复切换，本脚本不会自动重试'}
 Write-Host "已发送一次 $keyName；实际挑战状态请在游戏中确认"
 return [pscustomobject]@{status='input-sent';action=$Action;key=$keyName;challengeState='unknown'}
}

if($MyInvocation.InvocationName -ne '.'){
 $ErrorActionPreference='Stop'
 Invoke-KvkChallengeControl -Action $Action -DelaySeconds $DelaySeconds -DryRun:$DryRun
}
