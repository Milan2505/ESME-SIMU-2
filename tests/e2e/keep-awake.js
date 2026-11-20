// Playwright, globalSetup : pendant les tests de bout en bout, le poste ne se met pas en veille. Sous Windows, la veille
// moderne (événement Kernel-Power 506) fige Chromium au bout de quelques minutes d'inactivité : l'initiation complète
// (~15 min) restait bloquée jusqu'au réveil et échouait (20/11/2026). Un processus PowerShell appelle
// SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) et s'arrête avec les tests : aucun
// réglage du poste n'est modifié. Ailleurs que sous Windows : sans effet.
import { spawn } from 'node:child_process';

export default function keepAwake() {
    if (process.platform !== 'win32') return undefined;
    const script = [
        'Add-Type -Name Veille -Namespace Essais -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\'',
        '[Essais.Veille]::SetThreadExecutionState([uint32]"0x80000003") | Out-Null',
        `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
    ].join('; ');
    let child = null;
    try {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
        child.on('error', () => { /* PowerShell absent : les tests tournent quand même */ });
    } catch { /* idem */ }
    return () => { try { child?.kill(); } catch { /* déjà arrêté */ } };
}
