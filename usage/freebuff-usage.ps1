# Shows freebuff hours left, the same numbers /usage shows. Never prints the token.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FbCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);
  public static byte[] Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return null;
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      var b = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      return b;
    } finally { CredFree(p); }
  }
}
'@

$credFile = Join-Path $HOME '.config\manicode\credentials.json'
$blob = [FbCred]::Read("freebuff-cli/$credFile")
if (-not $blob) { throw "No freebuff sign-in in Credential Manager. Run freebuff and log in." }
$token = [Text.Encoding]::UTF8.GetString($blob)
if ($token.Contains([char]0)) { $token = [Text.Encoding]::Unicode.GetString($blob) }
$token = $token.Trim()

$headers = @{ Authorization = "Bearer $token"; 'x-fb-timezone' = [TimeZoneInfo]::Local.Id }
try { $tz = [TimeZoneInfo]::Local; $iana = $null
  [TimeZoneInfo]::TryConvertWindowsIdToIanaId($tz.Id, [ref]$iana) | Out-Null
  if ($iana) { $headers['x-fb-timezone'] = $iana } } catch {}

$endpoint = if ($args -contains '-models') { 'models' } else { 'session' }
$resp = Invoke-WebRequest -UseBasicParsing -Uri "https://www.codebuff.com/api/v1/freebuff/$endpoint" -Headers $headers -Method Get
$r = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
$token = $null
if ($args -contains '-models') {
  $settings = Get-Content (Join-Path $HOME '.config\manicode\settings.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  $s = Invoke-WebRequest -UseBasicParsing -Uri 'https://www.codebuff.com/api/v1/freebuff/session' -Headers $headers -Method Get
  $fbs = ([Text.Encoding]::UTF8.GetString($s.RawContentStream.ToArray()) | ConvertFrom-Json).freebucks
  $headers = $null
  [ordered]@{
    current = $settings.freebuffModelKey
    recommendedKey = $r.recommendedKey
    prices = $fbs.prices
    priceNotices = $fbs.priceNotices
    rows = @($r.rows | % { @{ key = $_.key; name = $_.displayName; tagline = $_.tagline; tooltip = $_.taglineTooltip; section = $_.placement.section; access = $_.access; digests = @($_.legacyDigests) } })
  } | ConvertTo-Json -Depth 5 -Compress
  return
}

# freebuff shows "hours" as freebucks / 5 (same rounding as the CLI)
function Hrs($fb) { [math]::Floor([math]::Max(0, $fb) / 5 + 1e-9) }
function T($iso) { if ($iso) { ([datetime]$iso).ToLocalTime().ToString('ddd h:mm tt') } }
# Desktop app counts the unused part of open hours as still left (refunded on stop) and shows h:mm.
function MinsLeft($o) { [math]::Max(0, ([datetime]$o.endsAt).ToUniversalTime().Subtract([datetime]::UtcNow).TotalMinutes) }
function HM($fbucks) { $m = [math]::Floor([math]::Max(0, $fbucks) / 5 * 60); '{0}:{1:00}' -f [math]::Floor($m / 60), ($m % 60) }
$fb = $r.freebucks
$openHours = @($fb.daily.openHours | ? { $_ })
$unused = 0; foreach ($o in $openHours) { $unused += $o.amount * (MinsLeft $o) / 60 }
$dsPrice = $fb.prices.'fbc/deepseek-flash'
$fastPrice = $fb.prices.'deepseek/deepseek-v4-flash'
$flashHours = if ($dsPrice) { [math]::Floor(($fb.daily.remaining + $unused) / $dsPrice) }
if ($args -contains '-json') {
  [ordered]@{
    today = @{ left = HM ($fb.daily.remaining + $unused); limit = Hrs $fb.daily.limit; resetAt = $fb.daily.resetAt
               flashHours = $flashHours; flashCost = $dsPrice / 5; fastCost = $fastPrice / 5 }
    month = @{ left = Hrs $fb.wallet.monthlyUsage.remaining; limit = Hrs $fb.wallet.monthlyUsage.limit; nextBonusAt = $fb.wallet.nextBonusAt }
    open  = @($openHours | % { @{ minsLeft = [math]::Round((MinsLeft $_)); endsAt = $_.endsAt } })
    plan  = @{ status = $r.subscription.status; renewsAt = $r.subscription.renewsAt }
  } | ConvertTo-Json -Depth 5 -Compress
  return
}
if ($fb) {
  $d = $fb.daily
  'Today:    {0} / {1} hours left   (resets {2})' -f (HM ($d.remaining + $unused)), (Hrs $d.limit), (T $d.resetAt)
  if ($dsPrice) { '          = {0} hours of DeepSeek V4.1 Flash (costs {1} hrs per hour)' -f [math]::Floor(($d.remaining + $unused) / $dsPrice), ($dsPrice / 5) }
  $w = $fb.wallet.monthlyUsage
  if ($w) { 'Monthly:  {0} / {1} hours left   (next bonus {2})' -f (Hrs $w.remaining), (Hrs $w.limit), (T $fb.wallet.nextBonusAt) }
  $open = $openHours
  'Running:  {0} session(s) now' -f $open.Count
  foreach ($o in $open) { '          {0} min left, ends {1}' -f [math]::Round((MinsLeft $o)), (T $o.endsAt) }
  if ($r.subscription) { 'Plan:     {0}, renews {1}' -f $r.subscription.status, (T $r.subscription.renewsAt) }
}
if (-not $fb -or $args -contains '-raw') {
  ($r | ConvertTo-Json -Depth 8) -replace '("[^"]*(token|secret|key)[^"]*"\s*:\s*)"[^"]*"', '$1"<hidden>"'
}


