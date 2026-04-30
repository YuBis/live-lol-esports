import './styles/scheduleStyle.css'

import { getLeaguesResponse, getScheduleResponse } from "../../utils/LoLEsportsAPI";
import { EventCard } from "./EventCard";
import { useEffect, useState } from "react";

import { Schedule, ScheduleEvent } from "../types/baseTypes";

type LeagueFilter = "ALL" | "LCK" | "LPL" | "LCS" | "LEC" | "ETC"

type LeagueImageMap = {
    [slug: string]: string;
}

type LeagueSummary = {
    slug: string;
    image?: string;
}

const LEAGUE_FILTERS: Array<{ key: LeagueFilter; label: string; leagueSlug?: string }> = [
    { key: "ALL", label: "ALL" },
    { key: "LCK", label: "LCK", leagueSlug: "lck" },
    { key: "LPL", label: "LPL", leagueSlug: "lpl" },
    { key: "LCS", label: "LCS", leagueSlug: "lcs" },
    { key: "LEC", label: "LEC", leagueSlug: "lec" },
    { key: "ETC", label: "ETC" },
]

export function EventsSchedule() {
    const [liveEvents, setLiveEvents] = useState<ScheduleEvent[]>([])
    const [last7DaysEvents, setLast7DaysEvents] = useState<ScheduleEvent[]>([])
    const [next7DaysEvents, setNext7DaysEvents] = useState<ScheduleEvent[]>([])
    const [selectedLeagueFilter, setSelectedLeagueFilter] = useState<LeagueFilter>("ALL")
    const [leagueImages, setLeagueImages] = useState<LeagueImageMap>({})

    useEffect(() => {
        getScheduleResponse().then(response => {
            let schedule: Schedule = response.data.data.schedule
            console.groupCollapsed(`Scheduled Matches: ${schedule.events.length}`)
            console.table(schedule.events)
            console.groupEnd()
            setLiveEvents(schedule.events.filter(filterLiveEvents))
            setLast7DaysEvents(schedule.events.filter(filterByLast7Days))
            setNext7DaysEvents(schedule.events.filter(filterByNext7Days))
        }).catch(error =>
            console.error(error)
        )

        getLeaguesResponse().then(response => {
            const leagues: LeagueSummary[] = response.data.data.leagues
            const newLeagueImages: LeagueImageMap = {}

            leagues.forEach((league) => {
                if (!league.slug || !league.image) return
                newLeagueImages[league.slug] = normalizeImageUrl(league.image)
            })

            setLeagueImages(newLeagueImages)
        }).catch(error =>
            console.error(error)
        )
    }, [])

    document.title = "LoL Live Esports";

    let scheduledEvents = [
        {
            emptyMessage: 'No Live Matches',
            scheduleEvents: liveEvents,
            title: 'Live Matches',
        },
        {
            emptyMessage: 'No Upcoming Matches',
            scheduleEvents: next7DaysEvents,
            title: 'Upcoming Matches',
        },
        {
            emptyMessage: 'No Recent Matches',
            scheduleEvents: last7DaysEvents,
            title: 'Recent Matches',
        }
    ]
    const listedEvents = getUniqueScheduleEvents(
        scheduledEvents
            .flatMap((scheduledEvent) => scheduledEvent.scheduleEvents)
            .filter((scheduleEvent) => scheduleEvent.league.slug !== "tft_esports")
    )

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
            {scheduledEvents.map(scheduledEvent => (
                <EventCards
                    key={scheduledEvent.title}
                    emptyMessage={scheduledEvent.emptyMessage}
                    scheduleEvents={scheduledEvent.scheduleEvents}
                    title={scheduledEvent.title}
                    selectedLeagueFilter={selectedLeagueFilter}
                    leagueImages={leagueImages}
                />
            ))}
        </div>
    );
}

type EventCardProps = {
    emptyMessage: string;
    scheduleEvents: ScheduleEvent[];
    title: string;
    selectedLeagueFilter: LeagueFilter;
    leagueImages: LeagueImageMap;
}

function EventCards({ emptyMessage, scheduleEvents, title, selectedLeagueFilter, leagueImages }: EventCardProps) {
    const filteredEvents = scheduleEvents
        .filter((scheduleEvent) => scheduleEvent.league.slug !== "tft_esports")
        .filter((scheduleEvent) => matchesLeagueFilter(scheduleEvent, selectedLeagueFilter))
        .sort((a, b) => {
            return (new Date(a.startTime).getTime() - new Date(b.startTime).getTime()) || a.league.name.localeCompare(b.league.name)
        })

    if (filteredEvents.length !== 0) {
        return (
            <div>
                <h2 className="games-of-day">{title}</h2>
                <div className="games-list-container">
                    <div className="games-list-items">
                        {filteredEvents.map(scheduleEvent => {
                            const leagueLogoUrl = leagueImages[scheduleEvent.league.slug]
                            return (
                                <EventCard
                                    key={`${scheduleEvent.match.id}_${scheduleEvent.startTime}`}
                                    scheduleEvent={scheduleEvent}
                                    leagueLogoUrl={leagueLogoUrl}
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
    const slug = scheduleEvent.league.slug.toLowerCase()
    if (slug === "lck") return "LCK"
    if (slug === "lpl") return "LPL"
    if (slug === "lcs") return "LCS"
    if (slug === "lec") return "LEC"
    return "ETC"
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
        const key = `${scheduleEvent.match.id}_${scheduleEvent.startTime}`
        if (!uniqueScheduleEvents.has(key)) {
            uniqueScheduleEvents.set(key, scheduleEvent)
        }
    })
    return Array.from(uniqueScheduleEvents.values())
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
