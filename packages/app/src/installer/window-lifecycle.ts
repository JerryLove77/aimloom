import type { Job } from './contracts';
export function canLeaveOperation(job: Job | null): boolean { return !job || !['running', 'unknown'].includes(job.state); }
/** Browser unload is a final lifecycle guard; in-app confirmation belongs to Dialog. */
export function installUnloadGuard(getJob: () => Job | null, target: Window = window) { const handler = (event: BeforeUnloadEvent) => { if (!canLeaveOperation(getJob())) {
    event.preventDefault();
    event.returnValue = '';
} }; target.addEventListener('beforeunload', handler); return () => target.removeEventListener('beforeunload', handler); }
