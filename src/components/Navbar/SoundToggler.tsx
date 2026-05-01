import {useEffect, useState} from "react";
import './styles/navbarStyle.css'
import TagManager from 'react-gtm-module'

// Anti ESA na live do Baiano
export function SoundToggler() {
    const [toggled, setToggled] = useState(false);

    useEffect(() => {
        const soundData = localStorage.getItem("sound");
        if (!soundData) {
            localStorage.setItem("sound", "mute");
            setToggled(false);
            return
        }

        if (soundData === "mute") {
            setToggled(false);
        } else if (soundData === "unmute") {
            setToggled(true)
        }
    }, [])

    const handleClick = () => {
        if(toggled) {
            localStorage.setItem("sound", "mute");
            TagManager.dataLayer({ dataLayer: { event: 'sound_toggled', action: 'muted'} })
        }else{
            localStorage.setItem("sound", "unmute");
            TagManager.dataLayer({ dataLayer: { event: 'sound_toggled', action: 'unmuted' } })
        }

        setToggled((s) => !s);
    }

    return (
        <div className="toggle-container">
            <div onClick={handleClick} className={`sound-toggle${toggled ? " muted" : ""}`}>
                <div className="notch">{`${toggled ? "🔊" : "🔈"}`}</div>
            </div>
        </div>
    );
}
