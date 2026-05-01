import './styles/playerStatusStyle.css'

import { GameMetadata, Team, WindowFrame, WindowParticipant } from "../types/baseTypes";

import { useEffect, useRef } from "react";
import { ToastContainer, toast } from 'react-toastify';

const kill = require("../../assets/audios/champion_slain.ogg");
const tower_blue = require("../../assets/audios/blue_turret_destroyed.ogg");
const tower_red = require("../../assets/audios/red_turret_destroyed.ogg");
const dragon_blue = require("../../assets/audios/blue_dragon_slain.ogg");
const dragon_red = require("../../assets/audios/red_dragon_slain.ogg");
const baron_blue = require("../../assets/audios/blue_baron_slain.ogg");
const baron_red = require("../../assets/audios/red_baron_slain.ogg");
const inib_blue = require("../../assets/audios/blue_inhibitor_destroyed.ogg");
const inib_red = require("../../assets/audios/red_inhibitor_destroyed.ogg");

type Props = {
    lastWindowFrame: WindowFrame,
    gameIndex: number,
    gameMetadata: GameMetadata,
    championsUrlWithPatchVersion: string,
    blueTeam: Team,
    redTeam: Team,
}

type StatusWatcher = {
    inhibitors: {
        blue: number,
        red: number
    }
    dragons: {
        blue: number,
        red: number
    }
    towers: {
        blue: number,
        red: number
    }
    barons: {
        blue: number,
        red: number
    }
    participants: {
        blue: WindowParticipant[]
        red: WindowParticipant[]
    }
    gameIndex: number
}

export function LiveAPIWatcher({ lastWindowFrame, gameIndex, gameMetadata, championsUrlWithPatchVersion, blueTeam, redTeam }: Props) {
    let trueBlueTeam = blueTeam
    let trueRedTeam = redTeam
    let swapTeams = blueTeam.id !== gameMetadata.blueTeamMetadata.esportsTeamId
    if (swapTeams) {
        trueBlueTeam = redTeam
        trueRedTeam = blueTeam
    }

    const statusRef = useRef<StatusWatcher>({
        dragons: { blue: lastWindowFrame.blueTeam.dragons.length, red: lastWindowFrame.redTeam.dragons.length },
        gameIndex: gameIndex,
        inhibitors: { blue: lastWindowFrame.blueTeam.inhibitors, red: lastWindowFrame.redTeam.inhibitors },
        towers: { blue: lastWindowFrame.blueTeam.towers, red: lastWindowFrame.redTeam.towers },
        barons: { blue: lastWindowFrame.blueTeam.barons, red: lastWindowFrame.redTeam.barons },
        participants: { blue: lastWindowFrame.blueTeam.participants, red: lastWindowFrame.redTeam.participants }
    })

    useEffect(() => {
        const soundData = localStorage.getItem("sound");
        const isMuted = soundData !== "unmute";
        const status = statusRef.current

        const toastQueue: Array<{
            blueTeam: boolean;
            sound: string;
            message: string;
            image: string;
            diff?: number;
        }> = []

        if (status.gameIndex === gameIndex) {
            if (status.inhibitors.blue !== lastWindowFrame.blueTeam.inhibitors) {
                toastQueue.push({ blueTeam: true, sound: inib_red.default, message: "억제기 파괴", image: trueBlueTeam.image })
            }

            if (status.inhibitors.red !== lastWindowFrame.redTeam.inhibitors) {
                toastQueue.push({ blueTeam: false, sound: inib_blue.default, message: "억제기 파괴", image: trueRedTeam.image })
            }

            if (status.barons.blue !== lastWindowFrame.blueTeam.barons) {
                toastQueue.push({ blueTeam: true, sound: baron_blue.default, message: "바론 처치", image: trueBlueTeam.image })
            }

            if (status.barons.red !== lastWindowFrame.redTeam.barons) {
                toastQueue.push({ blueTeam: false, sound: baron_red.default, message: "바론 처치", image: trueRedTeam.image })
            }

            if (status.dragons.blue !== lastWindowFrame.blueTeam.dragons.length) {
                toastQueue.push({ blueTeam: true, sound: dragon_blue.default, message: "드래곤 처치", image: trueBlueTeam.image })
            }

            if (status.dragons.red !== lastWindowFrame.redTeam.dragons.length) {
                toastQueue.push({ blueTeam: false, sound: dragon_red.default, message: "드래곤 처치", image: trueRedTeam.image })
            }

            if (status.towers.blue !== lastWindowFrame.blueTeam.towers) {
                toastQueue.push({ blueTeam: true, sound: tower_red.default, message: "포탑 파괴", image: trueBlueTeam.image })
            }

            if (status.towers.red !== lastWindowFrame.redTeam.towers) {
                toastQueue.push({ blueTeam: false, sound: tower_blue.default, message: "포탑 파괴", image: trueRedTeam.image })
            }

            for (let i = 0; i < status.participants.blue.length; i++) {
                if (status.participants.blue[i].kills !== lastWindowFrame.blueTeam.participants[i].kills) {
                    toastQueue.push({
                        blueTeam: true,
                        sound: kill.default,
                        message: "적 처치",
                        image: `${championsUrlWithPatchVersion}${gameMetadata.blueTeamMetadata.participantMetadata[status.participants.blue[i].participantId - 1].championId}.png`,
                        diff: lastWindowFrame.blueTeam.participants[i].kills - status.participants.blue[i].kills
                    })
                }
            }

            for (let i = 0; i < status.participants.red.length; i++) {
                if (status.participants.red[i].kills !== lastWindowFrame.redTeam.participants[i].kills) {
                    toastQueue.push({
                        blueTeam: false,
                        sound: kill.default,
                        message: "적 처치",
                        image: `${championsUrlWithPatchVersion}${gameMetadata.redTeamMetadata.participantMetadata[status.participants.red[i].participantId - 6].championId}.png`,
                        diff: lastWindowFrame.redTeam.participants[i].kills - status.participants.red[i].kills
                    })
                }
            }
        }

        let soundAlreadyPlaying = isMuted;
        toastQueue.forEach((toastEvent) => {
            createToast(
                toastEvent.blueTeam,
                soundAlreadyPlaying,
                toastEvent.sound,
                toastEvent.message,
                toastEvent.image,
                toastEvent.diff
            );
            soundAlreadyPlaying = true;
        });

        statusRef.current = {
            dragons: { blue: lastWindowFrame.blueTeam.dragons.length, red: lastWindowFrame.redTeam.dragons.length },
            gameIndex: gameIndex,
            inhibitors: { blue: lastWindowFrame.blueTeam.inhibitors, red: lastWindowFrame.redTeam.inhibitors },
            towers: { blue: lastWindowFrame.blueTeam.towers, red: lastWindowFrame.redTeam.towers },
            barons: { blue: lastWindowFrame.blueTeam.barons, red: lastWindowFrame.redTeam.barons },
            participants: { blue: lastWindowFrame.blueTeam.participants, red: lastWindowFrame.redTeam.participants },
        }

    }, [lastWindowFrame, gameIndex, gameMetadata.blueTeamMetadata.participantMetadata, gameMetadata.redTeamMetadata.participantMetadata, championsUrlWithPatchVersion, trueBlueTeam.image, trueRedTeam.image]);

    return (
        <ToastContainer limit={10}/>
    );
}

function createToast(blueTeam: boolean, soundIsPlaying: boolean, sound: string, message: string, image: string, diff?: number) {
    if (!soundIsPlaying) {
        let audio = new Audio(sound);
        audio.load();
        audio.volume = 0.20;
        audio.play();
    }

    let toastId = `${blueTeam}_${image}_${message}_${diff}`;
    if (blueTeam) {
        toast.info(
            <div className="toast-watcher">
                <div className="toast-image">
                    <img src={image} alt="blue team" />
                </div>
                <h4 style={{ color: "#FFF" }}>{message}</h4>
            </div>
            , {
                pauseOnHover: false,
                pauseOnFocusLoss: false,
                position: toast.POSITION.TOP_LEFT,
                toastId: toastId,
            }
        )
    } else {
        toast.error(
            <div className="toast-watcher">
                <img className="toast-image" src={image} alt="red team" />
                <h4 style={{ color: "#FFF" }}>{message}</h4>
            </div>
            , {
                pauseOnHover: false,
                pauseOnFocusLoss: false,
                position: toast.POSITION.TOP_RIGHT,
                toastId: toastId,
            }
        )
    }
}
