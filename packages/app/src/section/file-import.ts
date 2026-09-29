import type { FileAddKind, PlanFileAddRequest } from '../bridge/contracts'
import type { Lang, Msg } from '../i18n'
import { errorMsg } from './issue-text'
import { incompleteMsg, runPlan, type PlanRunner } from './run-plan'

/** What a section needs from the bridge to add an outside file to the game. */
export interface FileImportBridge extends PlanRunner {
  planFileAdd(input: PlanFileAddRequest): Promise<{ planId: string }>
  pickFile(kind: FileAddKind, lang: Lang): Promise<string | null>
}
/** What the add sheet hands over: the file it previewed, that file's hash, and the name to use. */
export interface FileImportInput { sourcePath: string; sourceSha256: string; file: string }
/** The import part of a section's state. `importError` belongs to the sheet, not the page. */
export interface FileImportState { importing: boolean; importError: Msg | null }

export type FileAddOutcome = { kind: 'added' } | { kind: 'unknown' } | { kind: 'refused'; message: Msg }

/**
 * Plans and carries out one add. The engine copies the source byte for byte and never
 * overwrites; a refusal comes back as a message for the sheet, and an unknown result stays unknown.
 */
export async function addFileToGame(bridge: FileImportBridge, operationId: string, request: PlanFileAddRequest): Promise<FileAddOutcome> {
  const fallback: Msg = { key: 'import.fallback' }
  let planId: string
  try { planId = (await bridge.planFileAdd(request)).planId } catch (error) { return { kind: 'refused', message: errorMsg(error, fallback) } }
  let outcome
  // Once execute has been sent, a transport failure no longer proves that nothing was written.
  try { outcome = await runPlan(bridge, operationId, planId) } catch { return { kind: 'unknown' } }
  if (outcome.kind === 'completed') return { kind: 'added' }
  if (outcome.kind === 'unknown') return { kind: 'unknown' }
  if (outcome.kind === 'failed') return { kind: 'refused', message: errorMsg(outcome.error, { key: 'import.failed' }) }
  if (outcome.kind === 'no-change') return { kind: 'refused', message: { key: 'import.duplicate' } }
  return { kind: 'refused', message: incompleteMsg('import.incomplete', outcome.status) }
}
