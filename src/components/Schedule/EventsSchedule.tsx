import './styles/scheduleStyle.css'

import { getLeaguesResponse, getScheduleResponse, getStandingsResponse, getTournamentsForLeagueResponse } from "../../utils/LoLEsportsAPI";
import { EventCard } from "./EventCard";
import { useEffect, useState } from "react";

import { Schedule, ScheduleEvent, Standing } from "../types/baseTypes";

type LeagueFilter = "ALL" | "LCK" | "LPL" | "LCS" | "LEC" | "ETC"
type LeagueCategory = Exclude<LeagueFilter, "ALL" | "ETC">

type LeagueImageMap = {
    [slug: string]: string;
}

type LeagueSummary = {
    id: string;
    slug: string;
    image?: string;
}

type TournamentSummary = {
    id: string;
    startDate: string;
    endDate: string;
}

type TeamRanksByEventKey = {
    [eventKey: string]: {
        blueRank?: number;
        redRank?: number;
    };
}

type LeagueFamilyRule = {
    filter: LeagueCategory;
    exactSlugs: string[];
    slugPrefixes?: string[];
    nameIncludes?: string[];
}

const LEAGUE_FILTERS: Array<{ key: LeagueFilter; label: string; leagueSlug?: string }> = [
    { key: "ALL", label: "ALL" },
    { key: "LCK", label: "LCK", leagueSlug: "lck" },
    { key: "LPL", label: "LPL", leagueSlug: "lpl" },
    { key: "LCS", label: "LCS", leagueSlug: "lcs" },
    { key: "LEC", label: "LEC", leagueSlug: "lec" },
    { key: "ETC", label: "ETC" },
]

const LEAGUE_FAMILY_RULES: LeagueFamilyRule[] = [
    {
        filter: "LCK",
        exactSlugs: [
            "lck",
            "lck_challengers_league",
        ],
        slugPrefixes: [
            "lck_",
        ],
        nameIncludes: [
            "lck",
        ],
    },
    {
        filter: "LPL",
        exactSlugs: [
            "lpl",
            "ldl",
        ],
        slugPrefixes: [
            "lpl_",
            "ldl",
        ],
        nameIncludes: [
            "lpl",
            "ldl",
        ],
    },
    {
        filter: "LCS",
        exactSlugs: [
            "lcs",
            "nacl",
            "lta_n",
            "lta_s",
            "lta_cross",
            "americas_cup",
        ],
        slugPrefixes: [
            "lcs_",
            "nacl",
        ],
        nameIncludes: [
            "lcs",
            "nacl",
            "lta north",
            "lta south",
            "americas cup",
            "north american challengers",
        ],
    },
    {
        filter: "LEC",
        exactSlugs: [
            "lec",
            "emea_masters",
            "arabian_league",
            "esports_balkan_league",
            "hellenic_legends_league",
            "hitpoint_masters",
            "lfl",
            "liga_portuguesa",
            "lit",
            "nlc",
            "north_regional_league",
            "primeleague",
            "rift_legends",
            "roadoflegends",
            "south_regional_league",
            "turkiye-sampiyonluk-ligi",
            "les",
        ],
        slugPrefixes: [
            "lec_",
        ],
        nameIncludes: [
            "lec",
            "emea masters",
        ],
    },
]

const MAX_DATE_SEARCH_PAGE_COUNT = 24
const MIN_EXTRA_PAGES_AFTER_DATE_HIT = 2
const RECENT_DATE_AVAILABILITY_DAYS = 14
const QUICK_DATE_OFFSETS: Array<{ key: string, label: string, offsetDays: number }> = [
    { key: `today`, label: `오늘`, offsetDays: 0 },
    { key: `yesterday`, label: `어제`, offsetDays: -1 },
    { key: `week_ago`, label: `7일 전`, offsetDays: -7 },
]

export function EventsSchedule() {
    const [liveEvents, setLiveEvents] = useState<ScheduleEvent[]>([])
    const [last7DaysEvents, setLast7DaysEvents] = useState<ScheduleEvent[]>([])
    const [next7DaysEvents, setNext7DaysEvents] = useState<ScheduleEvent[]>([])
    const [selectedDateEvents, setSelectedDateEvents] = useState<ScheduleEvent[]>([])
    const [selectedLeagueFilter, setSelectedLeagueFilter] = useState<LeagueFilter>("ALL")
    const [leagueImages, setLeagueImages] = useState<LeagueImageMap>({})
    const [leagues, setLeagues] = useState<LeagueSummary[]>([])
    const [teamRanksByEventKey, setTeamRanksByEventKey] = useState<TeamRanksByEventKey>({})
    const [isDateSearchFolded, setIsDateSearchFolded] = useState<boolean>(true)
    const [selectedDateValue, setSelectedDateValue] = useState<string>(() => getDateInputValue(new Date()))
    const [isDateSearchLoading, setIsDateSearchLoading] = useState<boolean>(false)
    const [isDateAvailabilityLoading, setIsDateAvailabilityLoading] = useState<boolean>(false)
    const [hasLoadedDateAvailability, setHasLoadedDateAvailability] = useState<boolean>(false)
    const [availableDateKeys, setAvailableDateKeys] = useState<string[]>([])
    const [hasDateSearchResult, setHasDateSearchResult] = useState<boolean>(false)
    const [dateSearchErrorMessage, setDateSearchErrorMessage] = useState<string>(``)

    useEffect(() => {
        let isMounted = true

        async function loadScheduleAndRankings() {
            try {
                const [scheduleResponse, leaguesResponse] = await Promise.all([
                    getScheduleResponse(),
                    getLeaguesResponse(),
                ])

                if (!isMounted) return

                const schedule: Schedule = scheduleResponse.data.data.schedule
                const leagues: LeagueSummary[] = leaguesResponse.data.data.leagues
                setLeagues(leagues)
                setAvailableDateKeys(extractUniqueEventDateKeys(schedule.events))

                console.groupCollapsed(`Scheduled Matches: ${schedule.events.length}`)
                console.table(schedule.events)
                console.groupEnd()

                setLiveEvents(schedule.events.filter(filterLiveEvents))
                setLast7DaysEvents(schedule.events.filter(filterByLast7Days))
                setNext7DaysEvents(schedule.events.filter(filterByNext7Days))

                const newLeagueImages: LeagueImageMap = {}
                leagues.forEach((league) => {
                    if (!league.slug || !league.image) return
                    newLeagueImages[league.slug] = normalizeImageUrl(league.image)
                })
                setLeagueImages(newLeagueImages)

                const rankings = await buildTeamRanksByEvent(schedule.events, leagues)
                if (!isMounted) return
                setTeamRanksByEventKey(rankings)

                setIsDateAvailabilityLoading(true)
                fetchScheduleDateAvailability().then((dateKeys) => {
                    if (!isMounted) return
                    setAvailableDateKeys(dateKeys)
                    setHasLoadedDateAvailability(true)
                }).catch((error) => {
                    console.error(error)
                }).finally(() => {
                    if (!isMounted) return
                    setIsDateAvailabilityLoading(false)
                })
            } catch (error) {
                console.error(error)
            }
        }

        loadScheduleAndRankings()

        return () => {
            isMounted = false
        }
    }, [])

    async function handleSearchByDate(dateValue: string) {
        if (!dateValue || isDateSearchLoading) return

        if (hasLoadedDateAvailability && availableDateKeys.length > 0 && !availableDateKeys.includes(dateValue)) {
            setDateSearchErrorMessage(``)
            setSelectedDateEvents([])
            setHasDateSearchResult(true)
            return
        }

        setDateSearchErrorMessage(``)
        setIsDateSearchLoading(true)
        setHasDateSearchResult(true)
        try {
            const dateEvents = await fetchScheduleEventsByDate(dateValue)
            setSelectedDateEvents(dateEvents)

            if (leagues.length > 0 && dateEvents.length > 0) {
                const dateEventRanksByKey = await buildTeamRanksByEvent(dateEvents, leagues)
                setTeamRanksByEventKey((previousState) => ({
                    ...previousState,
                    ...dateEventRanksByKey,
                }))
            }
        } catch (error) {
            console.error(error)
            setSelectedDateEvents([])
            setDateSearchErrorMessage(`선택한 날짜의 경기를 불러오지 못했습니다.`)
        } finally {
            setIsDateSearchLoading(false)
        }
    }

    async function handleSearchBySelectedDate() {
        await handleSearchByDate(selectedDateValue)
    }

    async function handleQuickDateButtonClick(dateValue: string) {
        setSelectedDateValue(dateValue)
        await handleSearchByDate(dateValue)
    }

    document.title = "LoL Live Esports";

    let scheduledEvents = [
        {
            emptyMessage: '진행 중인 경기가 없습니다',
            scheduleEvents: liveEvents,
            sectionKey: 'live',
            title: '경기 중',
        },
        {
            emptyMessage: '예정된 경기가 없습니다',
            scheduleEvents: next7DaysEvents,
            sectionKey: 'upcoming',
            title: '경기 예정',
        },
        {
            emptyMessage: '지난 경기가 없습니다',
            scheduleEvents: last7DaysEvents,
            sectionKey: 'recent',
            title: '지난 경기',
        }
    ]
    const listedEvents = getUniqueScheduleEvents(
        scheduledEvents
            .flatMap((scheduledEvent) => scheduledEvent.scheduleEvents)
            .concat(selectedDateEvents)
            .filter((scheduleEvent) => scheduleEvent.league.slug !== "tft_esports")
    )
    const selectedDateFilteredEvents = selectedDateEvents
        .filter((scheduleEvent) => scheduleEvent.league.slug !== "tft_esports")
        .filter((scheduleEvent) => matchesLeagueFilter(scheduleEvent, selectedLeagueFilter))
        .sort((a, b) => {
            const timeSort = new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            if (timeSort !== 0) return timeSort
            return a.league.name.localeCompare(b.league.name)
        })
    const selectedDateDisplayLabel = formatDateDisplayLabel(selectedDateValue)
    const availableDateKeySet = new Set(availableDateKeys)
    const selectedDateHasAvailableEvents = availableDateKeySet.has(selectedDateValue)
    const quickDateButtons = QUICK_DATE_OFFSETS.map((quickDateOffset) => {
        const dateValue = getRelativeDateInputValue(quickDateOffset.offsetDays)
        return {
            ...quickDateOffset,
            dateValue,
            hasData: availableDateKeySet.has(dateValue),
            isActive: selectedDateValue === dateValue,
        }
    })
    const recentDateAvailabilityItems = buildRecentDateAvailabilityItems(RECENT_DATE_AVAILABILITY_DAYS).map((availabilityItem) => ({
        ...availabilityItem,
        hasData: availableDateKeySet.has(availabilityItem.dateValue),
        isActive: selectedDateValue === availabilityItem.dateValue,
    }))

    return (
        <div className="orders-container">
            <div className="league-filter-container">
                {LEAGUE_FILTERS.map((leagueFilter) => {
                    const logoUrl = leagueFilter.leagueSlug ? leagueImages[leagueFilter.leagueSlug] : undefined
                    const isActive = selectedLeagueFilter === leagueFilter.key
                    const leagueCount = getLeagueFilterCount(listedEvents, leagueFilter.key)
                    return (
                        <button
                            key={leagueFilter.key}
                            type="button"
                            className={`league-filter-button ${isActive ? "active" : ""}`}
                            onClick={() => setSelectedLeagueFilter(leagueFilter.key)}
                        >
                            {logoUrl ? <img className="league-filter-button-logo" src={logoUrl} alt={`${leagueFilter.label} logo`} /> : null}
                            <span>{leagueFilter.label}</span>
                            <span className="league-filter-button-count">{leagueCount}</span>
                        </button>
                    )
                })}
            </div>
            <div className={`schedule-date-search-panel ${isDateSearchFolded ? `folded` : `expanded`}`}>
                <button
                    type="button"
                    className="schedule-date-search-toggle"
                    onClick={() => setIsDateSearchFolded((previousState) => !previousState)}
                    aria-expanded={!isDateSearchFolded}
                    aria-controls="schedule-date-search-controls"
                >
                    <span className="schedule-date-search-toggle-icon" aria-hidden="true">{isDateSearchFolded ? `▾` : `▴`}</span>
                    <span>날짜별 경기 보기</span>
                </button>
                {!isDateSearchFolded ? (
                    <div className="schedule-date-search-controls" id="schedule-date-search-controls">
                        <div className="schedule-date-search-quick-buttons">
                            {quickDateButtons.map((quickDateButton) => (
                                <button
                                    key={quickDateButton.key}
                                    type="button"
                                    className={`schedule-date-quick-button ${quickDateButton.isActive ? `active` : ``} ${quickDateButton.hasData ? `has-data` : `no-data`}`}
                                    onClick={() => void handleQuickDateButtonClick(quickDateButton.dateValue)}
                                >
                                    <span>{quickDateButton.label}</span>
                                    <span className="schedule-date-quick-button-date">{formatDateDisplayLabel(quickDateButton.dateValue)}</span>
                                </button>
                            ))}
                        </div>
                        <label htmlFor="schedule-date-input">날짜</label>
                        <input
                            id="schedule-date-input"
                            type="date"
                            value={selectedDateValue}
                            onChange={(event) => setSelectedDateValue(event.target.value)}
                        />
                        <span className={`schedule-date-selection-indicator ${selectedDateHasAvailableEvents ? `has-data` : `no-data`}`}>
                            {selectedDateHasAvailableEvents ? `데이터 있음` : `데이터 없음`}
                        </span>
                        <button
                            type="button"
                            className="schedule-date-search-button"
                            onClick={handleSearchBySelectedDate}
                            disabled={isDateSearchLoading || !selectedDateValue}
                        >
                            {isDateSearchLoading ? `불러오는 중...` : `불러오기`}
                        </button>
                        <div className="schedule-date-availability-strip">
                            {recentDateAvailabilityItems.map((availabilityItem) => (
                                <button
                                    key={`availability_${availabilityItem.dateValue}`}
                                    type="button"
                                    className={`schedule-date-availability-chip ${availabilityItem.hasData ? `has-data` : `no-data`} ${availabilityItem.isActive ? `active` : ``}`}
                                    onClick={() => setSelectedDateValue(availabilityItem.dateValue)}
                                >
                                    <span className="schedule-date-availability-chip-label">{availabilityItem.label}</span>
                                </button>
                            ))}
                        </div>
                        {isDateAvailabilityLoading ? (
                            <span className="schedule-date-availability-loading">날짜 데이터 인덱스를 불러오는 중...</span>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {hasDateSearchResult ? (
                <div>
                    <h2 className="games-of-day">선택 날짜 경기 ({selectedDateDisplayLabel})</h2>
                    {dateSearchErrorMessage ? (
                        <h3 className="schedule-date-search-error">{dateSearchErrorMessage}</h3>
                    ) : selectedDateFilteredEvents.length > 0 ? (
                        <div className="games-list-container">
                            <div className="games-list-items">
                                {selectedDateFilteredEvents.map((scheduleEvent) => {
                                    const leagueLogoUrl = leagueImages[scheduleEvent.league.slug]
                                    const teamRanks = teamRanksByEventKey[getEventKey(scheduleEvent)]
                                    return (
                                        <EventCard
                                            key={`selected_${scheduleEvent.match.id}_${scheduleEvent.startTime}`}
                                            scheduleEvent={scheduleEvent}
                                            leagueLogoUrl={leagueLogoUrl}
                                            teamRanks={teamRanks}
                                        />
                                    )
                                })}
                            </div>
                        </div>
                    ) : (
                        <h3 className="schedule-date-search-empty">선택한 날짜에 표시할 경기가 없습니다.</h3>
                    )}
                </div>
            ) : null}
            {scheduledEvents.map(scheduledEvent => (
                <EventCards
                    key={scheduledEvent.title}
                    emptyMessage={scheduledEvent.emptyMessage}
                    scheduleEvents={scheduledEvent.scheduleEvents}
                    sectionKey={scheduledEvent.sectionKey}
                    title={scheduledEvent.title}
                    selectedLeagueFilter={selectedLeagueFilter}
                    leagueImages={leagueImages}
                    teamRanksByEventKey={teamRanksByEventKey}
                />
            ))}
        </div>
    );
}

type EventCardProps = {
    emptyMessage: string;
    scheduleEvents: ScheduleEvent[];
    sectionKey: string;
    title: string;
    selectedLeagueFilter: LeagueFilter;
    leagueImages: LeagueImageMap;
    teamRanksByEventKey: TeamRanksByEventKey;
}

function EventCards({ emptyMessage, scheduleEvents, sectionKey, title, selectedLeagueFilter, leagueImages, teamRanksByEventKey }: EventCardProps) {
    const sortDirection = sectionKey === "recent" ? -1 : 1
    const filteredEvents = scheduleEvents
        .filter((scheduleEvent) => scheduleEvent.league.slug !== "tft_esports")
        .filter((scheduleEvent) => matchesLeagueFilter(scheduleEvent, selectedLeagueFilter))
        .sort((a, b) => {
            const timeSort = new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            if (timeSort !== 0) return timeSort * sortDirection
            return a.league.name.localeCompare(b.league.name)
        })

    if (filteredEvents.length !== 0) {
        return (
            <div>
                <h2 className="games-of-day">{title}</h2>
                <div className="games-list-container">
                    <div className="games-list-items">
                        {filteredEvents.map(scheduleEvent => {
                            const leagueLogoUrl = leagueImages[scheduleEvent.league.slug]
                            const teamRanks = teamRanksByEventKey[getEventKey(scheduleEvent)]
                            return (
                                <EventCard
                                    key={`${scheduleEvent.match.id}_${scheduleEvent.startTime}`}
                                    scheduleEvent={scheduleEvent}
                                    leagueLogoUrl={leagueLogoUrl}
                                    teamRanks={teamRanks}
                                />
                            )
                        })}
                    </div>
                </div>
            </div>
        );
    } else {
        return (
            <h2 className="games-of-day">{emptyMessage}</h2>
        );
    }
}

function normalizeImageUrl(url: string) {
    return url.replace("http://", "https://")
}

function getLeagueFilter(scheduleEvent: ScheduleEvent): Exclude<LeagueFilter, "ALL"> {
    const leagueSlug = normalizeLeagueSlug(scheduleEvent.league.slug)
    const leagueName = normalizeLeagueName(scheduleEvent.league.name)

    const matchedRule = LEAGUE_FAMILY_RULES.find((rule) => (
        matchesLeagueFamily(rule, leagueSlug, leagueName)
    ))
    if (matchedRule) return matchedRule.filter

    return "ETC"
}

function normalizeLeagueSlug(slug: string) {
    return (slug || "").trim().toLowerCase()
}

function normalizeLeagueName(name: string) {
    return (name || "").trim().toLowerCase().replace(/\s+/g, " ")
}

function matchesLeagueFamily(rule: LeagueFamilyRule, leagueSlug: string, leagueName: string) {
    if (rule.exactSlugs.includes(leagueSlug)) return true
    if (rule.slugPrefixes && rule.slugPrefixes.some((prefix) => leagueSlug.startsWith(prefix))) return true
    if (rule.nameIncludes && rule.nameIncludes.some((namePart) => leagueName.includes(namePart))) return true
    return false
}

function matchesLeagueFilter(scheduleEvent: ScheduleEvent, selectedLeagueFilter: LeagueFilter) {
    if (selectedLeagueFilter === "ALL") return true
    return getLeagueFilter(scheduleEvent) === selectedLeagueFilter
}

function getLeagueFilterCount(scheduleEvents: ScheduleEvent[], selectedLeagueFilter: LeagueFilter) {
    return scheduleEvents.filter((scheduleEvent) => matchesLeagueFilter(scheduleEvent, selectedLeagueFilter)).length
}

function getUniqueScheduleEvents(scheduleEvents: ScheduleEvent[]) {
    const uniqueScheduleEvents = new Map<string, ScheduleEvent>()
    scheduleEvents.forEach((scheduleEvent) => {
        const key = getEventKey(scheduleEvent)
        if (!uniqueScheduleEvents.has(key)) {
            uniqueScheduleEvents.set(key, scheduleEvent)
        }
    })
    return Array.from(uniqueScheduleEvents.values())
}

function getEventKey(scheduleEvent: ScheduleEvent) {
    return `${scheduleEvent.match.id}_${getEventStartTimeKeyPart(scheduleEvent.startTime)}`
}

function getEventStartTimeKeyPart(startTime: Date | string) {
    const parsedDate = new Date(startTime)
    if (Number.isFinite(parsedDate.getTime())) {
        return parsedDate.toISOString()
    }
    return String(startTime)
}

async function buildTeamRanksByEvent(scheduleEvents: ScheduleEvent[], leagues: LeagueSummary[]): Promise<TeamRanksByEventKey> {
    const eventRanksByKey: TeamRanksByEventKey = {}
    const rankedEvents = getUniqueScheduleEvents(
        scheduleEvents.filter((scheduleEvent) => (
            scheduleEvent.match &&
            scheduleEvent.match.id &&
            scheduleEvent.match.teams &&
            scheduleEvent.match.teams.length === 2 &&
            scheduleEvent.league.slug !== "tft_esports"
        ))
    )
    if (rankedEvents.length === 0) return eventRanksByKey

    const leagueIdBySlug: { [slug: string]: string } = {}
    leagues.forEach((league) => {
        if (!league.slug || !league.id) return
        leagueIdBySlug[league.slug] = league.id
    })

    const leagueSlugs = Array.from(new Set(rankedEvents.map((event) => event.league.slug))).filter((slug) => Boolean(leagueIdBySlug[slug]))
    const tournamentsByLeagueSlug: { [slug: string]: TournamentSummary[] } = {}

    const tournamentsByLeague = await Promise.all(leagueSlugs.map(async (slug) => {
        try {
            const response = await getTournamentsForLeagueResponse(leagueIdBySlug[slug])
            const leaguesFromResponse = response.data.data.leagues as Array<{ tournaments: TournamentSummary[] }>
            const tournaments = leaguesFromResponse && leaguesFromResponse[0] ? leaguesFromResponse[0].tournaments || [] : []
            return { slug, tournaments }
        } catch (error) {
            console.error(error)
            return { slug, tournaments: [] as TournamentSummary[] }
        }
    }))

    tournamentsByLeague.forEach((result) => {
        tournamentsByLeagueSlug[result.slug] = result.tournaments
    })

    const eventTournamentIdByKey: { [eventKey: string]: string } = {}
    rankedEvents.forEach((event) => {
        const tournaments = tournamentsByLeagueSlug[event.league.slug] || []
        const tournamentId = getTournamentIdForEvent(event.startTime, tournaments)
        if (!tournamentId) return
        eventTournamentIdByKey[getEventKey(event)] = tournamentId
    })

    const tournamentIds = Array.from(new Set(Object.values(eventTournamentIdByKey)))
    const standingsByTournamentId: { [tournamentId: string]: { [teamCode: string]: number } } = {}
    const standingsResults = await Promise.all(tournamentIds.map(async (tournamentId) => {
        try {
            const response = await getStandingsResponse(tournamentId)
            const standings: Standing[] = response.data.data.standings
            return { tournamentId, teamRanksByCode: getTeamRanksByCodeFromStandings(standings) }
        } catch (error) {
            console.error(error)
            return { tournamentId, teamRanksByCode: {} as { [teamCode: string]: number } }
        }
    }))

    standingsResults.forEach((result) => {
        standingsByTournamentId[result.tournamentId] = result.teamRanksByCode
    })

    rankedEvents.forEach((event) => {
        const eventKey = getEventKey(event)
        const tournamentId = eventTournamentIdByKey[eventKey]
        if (!tournamentId) return
        const teamRanksByCode = standingsByTournamentId[tournamentId]
        if (!teamRanksByCode) return

        const blueRank = teamRanksByCode[event.match.teams[0].code]
        const redRank = teamRanksByCode[event.match.teams[1].code]
        if (!blueRank && !redRank) return

        eventRanksByKey[eventKey] = {
            blueRank: blueRank,
            redRank: redRank,
        }
    })

    return eventRanksByKey
}

function getTournamentIdForEvent(eventStartTime: Date | string, tournaments: TournamentSummary[]) {
    if (!tournaments || tournaments.length === 0) return undefined

    const eventTime = new Date(eventStartTime).getTime()
    if (!Number.isFinite(eventTime)) {
        return tournaments[0].id
    }

    const exactRangeTournament = tournaments.find((tournament) => (
        isEventInTournamentRange(eventTime, tournament.startDate, tournament.endDate)
    ))
    if (exactRangeTournament) return exactRangeTournament.id

    const startedBeforeEvent = tournaments
        .filter((tournament) => (new Date(tournament.startDate).getTime() <= eventTime))
        .sort((a, b) => (new Date(b.startDate).getTime() - new Date(a.startDate).getTime()))
    if (startedBeforeEvent.length > 0) return startedBeforeEvent[0].id

    return tournaments
        .slice()
        .sort((a, b) => (new Date(a.startDate).getTime() - new Date(b.startDate).getTime()))[0]?.id
}

function isEventInTournamentRange(eventTime: number, tournamentStartDate: string, tournamentEndDate: string) {
    const startTime = new Date(tournamentStartDate).getTime()
    const endTime = new Date(tournamentEndDate).getTime()
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return false

    const ONE_DAY_MS = 24 * 60 * 60 * 1000
    const inclusiveEndTime = endTime + ONE_DAY_MS - 1
    return eventTime >= startTime && eventTime <= inclusiveEndTime
}

function getTeamRanksByCodeFromStandings(standings: Standing[]) {
    const teamRanksByCode: { [teamCode: string]: number } = {}
    if (!standings || standings.length === 0) return teamRanksByCode

    standings.forEach((standing) => {
        standing.stages.forEach((stage) => {
            stage.sections.forEach((section) => {
                section.rankings.forEach((ranking) => {
                    ranking.teams.forEach((team) => {
                        if (!team.code) return
                        const currentRank = teamRanksByCode[team.code]
                        if (!currentRank || ranking.ordinal < currentRank) {
                            teamRanksByCode[team.code] = ranking.ordinal
                        }
                    })
                })
            })
        })
    })

    return teamRanksByCode
}

function filterLiveEvents(scheduleEvent: ScheduleEvent) {
    if (!scheduleEvent.match) return false
    if (scheduleEvent.state === "inProgress") return true

    const blueTeamResult = scheduleEvent.match.teams[0].result
    const redTeamResult = scheduleEvent.match.teams[1].result

    const blueTeamInSeries = Boolean(
        blueTeamResult &&
        blueTeamResult.gameWins > 0 &&
        !blueTeamResult.outcome
    )
    const redTeamInSeries = Boolean(
        blueTeamResult &&
        redTeamResult &&
        redTeamResult.gameWins > 0 &&
        !redTeamResult.outcome
    )

    const matchIsLiveBySeries = blueTeamInSeries || redTeamInSeries
    return (scheduleEvent.state === "unstarted" || scheduleEvent.state === "completed") && matchIsLiveBySeries
}

function filterByLast7Days(scheduleEvent: ScheduleEvent) {
    if (scheduleEvent.state === "completed" || (scheduleEvent.match && (scheduleEvent.match.teams[0].result && scheduleEvent.match.teams[0].result.outcome))) {
        let minDate = new Date();
        let maxDate = new Date()
        minDate.setDate(minDate.getDate() - 7)
        maxDate.setHours(maxDate.getHours() - 1)
        let eventDate = new Date(scheduleEvent.startTime)

        if (eventDate.valueOf() > minDate.valueOf() && eventDate.valueOf() < maxDate.valueOf()) {

            if (scheduleEvent.match === undefined) return false
            if (scheduleEvent.match.id === undefined) return false

            return true;
        } else {
            return false;
        }
    } else {
        return false
    }
}

function filterByNext7Days(scheduleEvent: ScheduleEvent) {
    if (scheduleEvent.match) {
        const blueTeamHasWins = Boolean(scheduleEvent.match.teams[0].result && scheduleEvent.match.teams[0].result.gameWins > 0)
        const redTeamHasWins = Boolean(scheduleEvent.match.teams[1].result && scheduleEvent.match.teams[1].result.gameWins > 0)
        const completedWithBlueScore = scheduleEvent.state === "completed" && blueTeamHasWins

        if (scheduleEvent.state === "inProgress" || completedWithBlueScore || redTeamHasWins) {
            return false
        }
    }
    let minDate = new Date();
    let maxDate = new Date()
    minDate.setHours(minDate.getHours() - 1)
    maxDate.setDate(maxDate.getDate() + 7)
    let eventDate = new Date(scheduleEvent.startTime)

    if (eventDate.valueOf() > minDate.valueOf() && eventDate.valueOf() < maxDate.valueOf()) {

        if (scheduleEvent.match === undefined) return false
        if (scheduleEvent.match.id === undefined) return false

        return true;
    } else {
        return false;
    }
}

function getDateInputValue(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, `0`)
    const day = String(date.getDate()).padStart(2, `0`)
    return `${year}-${month}-${day}`
}

function formatDateDisplayLabel(dateValue: string) {
    if (!dateValue) return `-`
    const [year, month, day] = dateValue.split(`-`).map((token) => Number(token))
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateValue
    return `${year}.${String(month).padStart(2, `0`)}.${String(day).padStart(2, `0`)}`
}

function getLocalDateKey(dateLike: Date | string) {
    const date = new Date(dateLike)
    if (!Number.isFinite(date.getTime())) return ``
    return getDateInputValue(date)
}

function isEventOnDateValue(scheduleEvent: ScheduleEvent, targetDateValue: string) {
    return getLocalDateKey(scheduleEvent.startTime) === targetDateValue
}

async function fetchScheduleEventsByDate(targetDateValue: string) {
    const uniqueEventsByKey = new Map<string, ScheduleEvent>()
    const visitedPageTokens = new Set<string>([`__root__`])
    const pageTokenQueue: string[] = [``]
    let fetchedPageCount = 0
    let pagesFetchedAfterDateHit = 0

    while (pageTokenQueue.length > 0 && fetchedPageCount < MAX_DATE_SEARCH_PAGE_COUNT) {
        const currentPageToken = pageTokenQueue.shift() || ``
        const scheduleResponse = await getScheduleResponse(currentPageToken || undefined)
        const schedule: Schedule = scheduleResponse.data.data.schedule
        fetchedPageCount += 1

        let hasDateHitInCurrentPage = false
        schedule.events.forEach((scheduleEvent) => {
            if (!isEventOnDateValue(scheduleEvent, targetDateValue)) return
            hasDateHitInCurrentPage = true
            uniqueEventsByKey.set(getEventKey(scheduleEvent), scheduleEvent)
        })

        if (hasDateHitInCurrentPage) {
            pagesFetchedAfterDateHit = 0
        } else if (uniqueEventsByKey.size > 0) {
            pagesFetchedAfterDateHit += 1
            if (pagesFetchedAfterDateHit >= MIN_EXTRA_PAGES_AFTER_DATE_HIT) {
                break
            }
        }

        const olderPageToken = String(schedule.pages?.older || ``)
        const newerPageToken = String(schedule.pages?.newer || ``)
        if (olderPageToken && !visitedPageTokens.has(olderPageToken)) {
            visitedPageTokens.add(olderPageToken)
            pageTokenQueue.push(olderPageToken)
        }
        if (newerPageToken && !visitedPageTokens.has(newerPageToken)) {
            visitedPageTokens.add(newerPageToken)
            pageTokenQueue.push(newerPageToken)
        }
    }

    return Array.from(uniqueEventsByKey.values())
}

async function fetchScheduleDateAvailability() {
    const availableDateKeySet = new Set<string>()
    const visitedPageTokens = new Set<string>([`__root__`])
    const pageTokenQueue: string[] = [``]
    let fetchedPageCount = 0

    while (pageTokenQueue.length > 0 && fetchedPageCount < MAX_DATE_SEARCH_PAGE_COUNT) {
        const currentPageToken = pageTokenQueue.shift() || ``
        const scheduleResponse = await getScheduleResponse(currentPageToken || undefined)
        const schedule: Schedule = scheduleResponse.data.data.schedule
        fetchedPageCount += 1

        extractUniqueEventDateKeys(schedule.events).forEach((dateKey) => availableDateKeySet.add(dateKey))

        const olderPageToken = String(schedule.pages?.older || ``)
        const newerPageToken = String(schedule.pages?.newer || ``)
        if (olderPageToken && !visitedPageTokens.has(olderPageToken)) {
            visitedPageTokens.add(olderPageToken)
            pageTokenQueue.push(olderPageToken)
        }
        if (newerPageToken && !visitedPageTokens.has(newerPageToken)) {
            visitedPageTokens.add(newerPageToken)
            pageTokenQueue.push(newerPageToken)
        }
    }

    return Array.from(availableDateKeySet.values()).sort((leftDateKey, rightDateKey) => leftDateKey.localeCompare(rightDateKey))
}

function extractUniqueEventDateKeys(scheduleEvents: ScheduleEvent[]) {
    const dateKeySet = new Set<string>()
    scheduleEvents.forEach((scheduleEvent) => {
        const dateKey = getLocalDateKey(scheduleEvent.startTime)
        if (!dateKey) return
        dateKeySet.add(dateKey)
    })
    return Array.from(dateKeySet.values())
}

function getRelativeDateInputValue(offsetDays: number) {
    const date = new Date()
    date.setDate(date.getDate() + offsetDays)
    return getDateInputValue(date)
}

function buildRecentDateAvailabilityItems(days: number) {
    const safeDays = Math.max(1, days)
    const items: Array<{ dateValue: string, label: string }> = []
    for (let dayOffset = 0; dayOffset < safeDays; dayOffset += 1) {
        const date = new Date()
        date.setDate(date.getDate() - dayOffset)
        items.push({
            dateValue: getDateInputValue(date),
            label: `${date.getMonth() + 1}/${date.getDate()}`,
        })
    }
    return items
}
