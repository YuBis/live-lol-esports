import {
    applyScoreboardLayoutBodyClassNames,
    getInitialScoreboardLayoutMode,
    getScoreboardLayoutModeClassName,
    parseScoreboardLayoutMode,
} from './scoreboardLayout'

describe(`scoreboardLayout`, () => {
    beforeEach(() => {
        document.body.className = ``
        window.localStorage.clear()
        window.history.replaceState({}, ``, `/`)
    })

    it(`falls back to classic for unknown values and migrates legacy compact3`, () => {
        expect(parseScoreboardLayoutMode(null)).toBe(`classic`)
        expect(parseScoreboardLayoutMode(`unknown-layout`)).toBe(`classic`)
        expect(parseScoreboardLayoutMode(`mirrorCompact3`)).toBe(`mirrorCompact2`)
    })

    it(`builds card class names for classic and compact mirror layouts`, () => {
        expect(getScoreboardLayoutModeClassName(`classic`)).toBe(``)
        expect(getScoreboardLayoutModeClassName(`mirror`)).toBe(`status-live-game-card-mirror-mode`)
        expect(getScoreboardLayoutModeClassName(`mirrorCompact2`)).toBe(
            `status-live-game-card-mirror-mode status-live-game-card-mirror-compact-mode status-live-game-card-mirror-compact-2-mode`,
        )
        expect(getScoreboardLayoutModeClassName(`basicCompact`)).toBe(`status-live-game-card-basic-compact-mode`)
    })

    it(`applies and cleans up body classes for mirror compact modes`, () => {
        document.body.classList.add(`mirror-scoreboard-mode`, `mirror-scoreboard-compact-2-mode`)

        const cleanup = applyScoreboardLayoutBodyClassNames(`mirrorCompact2`)

        expect(document.body.classList.contains(`mirror-scoreboard-mode`)).toBe(true)
        expect(document.body.classList.contains(`mirror-scoreboard-compact-mode`)).toBe(true)
        expect(document.body.classList.contains(`mirror-scoreboard-compact-2-mode`)).toBe(true)
        expect(document.body.classList.contains(`mirror-scoreboard-compact-3-mode`)).toBe(false)

        cleanup()

        expect(document.body.classList.contains(`mirror-scoreboard-mode`)).toBe(false)
        expect(document.body.classList.contains(`mirror-scoreboard-compact-mode`)).toBe(false)
        expect(document.body.classList.contains(`mirror-scoreboard-compact-2-mode`)).toBe(false)
    })

    it(`supports basic compact body class and query-param mode override`, () => {
        window.localStorage.setItem(`scoreboardLayoutMode`, `mirrorCompact2`)
        window.history.replaceState({}, ``, `/?layout=basicCompact`)

        expect(getInitialScoreboardLayoutMode()).toBe(`basicCompact`)

        const cleanup = applyScoreboardLayoutBodyClassNames(`basicCompact`)

        expect(document.body.classList.contains(`basic-scoreboard-compact-mode`)).toBe(true)
        expect(document.body.classList.contains(`mirror-scoreboard-mode`)).toBe(false)

        cleanup()
        expect(document.body.classList.contains(`basic-scoreboard-compact-mode`)).toBe(false)
    })
})
