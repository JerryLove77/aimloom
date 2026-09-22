import type { MessageKey } from '../i18n'

const ids = ['location', 'materials', 'personal', 'backup', 'conflict', 'recovery', 'blocked'] as const
/** The help articles, in order; their text lives in src/i18n under installer.help.<id>. */
export const helpArticles = ids.map(id => ({
    id,
    title: `installer.help.${id}.title` as const satisfies MessageKey,
    body: `installer.help.${id}.body` as const satisfies MessageKey,
}));
