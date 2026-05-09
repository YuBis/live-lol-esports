export type ScoreboardLayoutMode = `classic` | `mirror` | `mirrorCompact2` | `basicCompact`

export const SCOREBOARD_LAYOUT_MODE_STORAGE_KEY = `scoreboardLayoutMode`
const SCOREBOARD_LAYOUT_MODE_QUERY_PARAM_KEY = `layout`

export const SCOREBOARD_LAYOUT_MODE_OPTIONS: ScoreboardLayoutMode[] = [
    `classic`,
    `basicCompact`,
    `mirror`,
    `mirrorCompact2`,
]

export const SCOREBOARD_LAYOUT_MODE_LABELS: { [layoutMode in ScoreboardLayoutMode]: string } = {
    classic: `\uB808\uC774\uC544\uC6C3: \uAE30\uBCF8`,
    mirror: `\uB808\uC774\uC544\uC6C3: \uBBF8\uB7EC`,
    mirrorCompact2: `\uB808\uC774\uC544\uC6C3: \uBBF8\uB7EC \uC555\uCD95\uBAA8\uB4DC`,
    basicCompact: `\uB808\uC774\uC544\uC6C3: \uAE30\uBCF8 \uC555\uCD95\uBAA8\uB4DC`,
}

const SCOREBOARD_LAYOUT_BODY_CLASS_NAMES = [
    `mirror-scoreboard-mode`,
    `mirror-scoreboard-compact-mode`,
    `mirror-scoreboard-compact-2-mode`,
    `basic-scoreboard-compact-mode`,
    // Legacy class from removed mirrorCompact3 mode.
    `mirror-scoreboard-compact-3-mode`,
]

const LEGACY_SCOREBOARD_LAYOUT_MODE_MIGRATIONS: { [legacyMode: string]: ScoreboardLayoutMode } = {
    mirrorCompact3: `mirrorCompact2`,
}

export function getInitialScoreboardLayoutMode(): ScoreboardLayoutMode {
    const queryLayoutMode = getScoreboardLayoutModeFromQueryParam()
    if (queryLayoutMode) return queryLayoutMode

    try {
        return parseScoreboardLayoutMode(localStorage.getItem(SCOREBOARD_LAYOUT_MODE_STORAGE_KEY))
    } catch {
        return `classic`
    }
}

export function parseScoreboardLayoutMode(value: string | null): ScoreboardLayoutMode {
    const migratedValue = value ? LEGACY_SCOREBOARD_LAYOUT_MODE_MIGRATIONS[value] : undefined
    const normalizedValue = migratedValue ?? value
    return SCOREBOARD_LAYOUT_MODE_OPTIONS.includes(normalizedValue as ScoreboardLayoutMode)
        ? normalizedValue as ScoreboardLayoutMode
        : `classic`
}

export function isMirrorScoreboardLayoutMode(layoutMode: ScoreboardLayoutMode) {
    return layoutMode === `mirror` || layoutMode === `mirrorCompact2`
}

export function isCompactMirrorScoreboardLayoutMode(layoutMode: ScoreboardLayoutMode) {
    return layoutMode === `mirrorCompact2`
}

export function isBasicCompactScoreboardLayoutMode(layoutMode: ScoreboardLayoutMode) {
    return layoutMode === `basicCompact`
}

export function getScoreboardLayoutModeClassName(layoutMode: ScoreboardLayoutMode) {
    if (layoutMode === `classic`) return ``
    if (isBasicCompactScoreboardLayoutMode(layoutMode)) return `status-live-game-card-basic-compact-mode`

    const compactClassName = isCompactMirrorScoreboardLayoutMode(layoutMode) ? `status-live-game-card-mirror-compact-mode` : ``
    const splitClassName = layoutMode === `mirrorCompact2`
        ? `status-live-game-card-mirror-compact-2-mode`
        : ``

    return [`status-live-game-card-mirror-mode`, compactClassName, splitClassName].filter(Boolean).join(` `)
}

export function applyScoreboardLayoutBodyClassNames(layoutMode: ScoreboardLayoutMode) {
    document.body.classList.remove(...SCOREBOARD_LAYOUT_BODY_CLASS_NAMES)

    if (isMirrorScoreboardLayoutMode(layoutMode)) document.body.classList.add(`mirror-scoreboard-mode`)
    if (isCompactMirrorScoreboardLayoutMode(layoutMode)) document.body.classList.add(`mirror-scoreboard-compact-mode`)
    if (layoutMode === `mirrorCompact2`) document.body.classList.add(`mirror-scoreboard-compact-2-mode`)
    if (isBasicCompactScoreboardLayoutMode(layoutMode)) document.body.classList.add(`basic-scoreboard-compact-mode`)

    return () => {
        document.body.classList.remove(...SCOREBOARD_LAYOUT_BODY_CLASS_NAMES)
    }
}

function getScoreboardLayoutModeFromQueryParam() {
    try {
        if (typeof window === `undefined`) return undefined

        const queryValue = new URLSearchParams(window.location.search).get(SCOREBOARD_LAYOUT_MODE_QUERY_PARAM_KEY)
        if (!queryValue) return undefined

        const migratedValue = LEGACY_SCOREBOARD_LAYOUT_MODE_MIGRATIONS[queryValue] ?? queryValue
        if (!SCOREBOARD_LAYOUT_MODE_OPTIONS.includes(migratedValue as ScoreboardLayoutMode)) return undefined

        return migratedValue as ScoreboardLayoutMode
    } catch {
        return undefined
    }
}
