import { useEffect } from "react";

/** P R O L I A N T, then up, down. */
const CODE = ["p", "r", "o", "l", "i", "a", "n", "t", "ArrowUp", "ArrowDown"];

/** How fast the fans go; the icons turn at the same speed (see App.css). */
const RPM = 20_000;
/** Blades on a server fan; with RPM this sets the pitch of its whine. */
const BLADES = 7;
const SPIN_UP_S = 3.5;
const SPIN_DOWN_S = 2.5;

/**
 * An easter egg: typing the code anywhere sets every icon in the app
 * spinning at 20 000 rpm (see [data-proliant] in App.css), and the fans of a
 * rack server at full blast roar up with it. Typing it again spins them
 * down. Not kept between runs.
 */
export function useProliant() {
    useEffect(() => {
        let position = 0;
        let fans: Fans | null = null;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
            // A wrong key starts over, or counts as the first if it is one.
            position = key === CODE[position] ? position + 1 : key === CODE[0] ? 1 : 0;
            if (position < CODE.length) return;
            position = 0;
            const on = document.documentElement.toggleAttribute("data-proliant");
            if (on) {
                fans?.stop();
                fans = startFans();
            } else {
                fans?.stop();
                fans = null;
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            fans?.stop();
        };
    }, []);
}

interface Fans {
    stop: () => void;
}

/**
 * The sound of a server's fans, made here rather than recorded: air noise
 * through two filters (the rush, and the hiss of air through a grille), the
 * whine of the blades passing — rpm / 60 × blades, with its harmonics —
 * wobbling slightly as six fans drift against each other, all rising from
 * nothing as the fans spin up. Nothing plays where the system asks for less
 * motion, as with the icons.
 */
function startFans(): Fans | null {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    const audio = new Context();
    const now = audio.currentTime;

    const master = audio.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.32, now + SPIN_UP_S);
    master.connect(audio.destination);

    // Two seconds of noise, looped.
    const noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const air = audio.createBufferSource();
    air.buffer = noise;
    air.loop = true;

    // The rush: low and wide, opening up as the fans speed up.
    const rush = audio.createBiquadFilter();
    rush.type = "lowpass";
    rush.Q.value = 0.7;
    rush.frequency.setValueAtTime(200, now);
    rush.frequency.exponentialRampToValueAtTime(2600, now + SPIN_UP_S);
    const rushLevel = audio.createGain();
    rushLevel.gain.value = 0.9;
    air.connect(rush).connect(rushLevel).connect(master);

    // The hiss of air forced through the front grille.
    const hiss = audio.createBiquadFilter();
    hiss.type = "bandpass";
    hiss.Q.value = 1.2;
    hiss.frequency.setValueAtTime(1500, now);
    hiss.frequency.exponentialRampToValueAtTime(6500, now + SPIN_UP_S);
    const hissLevel = audio.createGain();
    hissLevel.gain.value = 0.35;
    air.connect(hiss).connect(hissLevel).connect(master);

    // The blades' whine, a few fans a little apart, with a slow wobble.
    const whine = (RPM / 60) * BLADES;
    const tones: OscillatorNode[] = [];
    [
        { ratio: 1, detune: 0, level: 0.05 },
        { ratio: 1, detune: 9, level: 0.04 },
        { ratio: 1, detune: -14, level: 0.035 },
        { ratio: 2, detune: 4, level: 0.015 },
        { ratio: 0.5, detune: -6, level: 0.03 },
    ].forEach(({ ratio, detune, level }) => {
        const tone = audio.createOscillator();
        tone.type = "sawtooth";
        tone.frequency.setValueAtTime(40, now);
        tone.frequency.exponentialRampToValueAtTime(whine * ratio, now + SPIN_UP_S);
        tone.detune.value = detune;
        const soften = audio.createBiquadFilter();
        soften.type = "lowpass";
        soften.frequency.value = whine * ratio * 2.5;
        const gain = audio.createGain();
        gain.gain.value = level;
        tone.connect(soften).connect(gain).connect(master);
        tones.push(tone);
    });
    const wobble = audio.createOscillator();
    wobble.frequency.value = 0.7;
    const wobbleDepth = audio.createGain();
    wobbleDepth.gain.value = 6; // cents
    wobble.connect(wobbleDepth);
    tones.forEach((tone) => wobbleDepth.connect(tone.detune));

    const sources: AudioScheduledSourceNode[] = [air, wobble, ...tones];
    sources.forEach((source) => source.start(now));

    return {
        stop() {
            const at = audio.currentTime;
            const end = at + SPIN_DOWN_S;
            master.gain.cancelScheduledValues(at);
            master.gain.setValueAtTime(master.gain.value, at);
            master.gain.linearRampToValueAtTime(0, end);
            for (const tone of tones) {
                tone.frequency.cancelScheduledValues(at);
                tone.frequency.setValueAtTime(tone.frequency.value, at);
                tone.frequency.exponentialRampToValueAtTime(30, end);
            }
            rush.frequency.cancelScheduledValues(at);
            rush.frequency.setValueAtTime(rush.frequency.value, at);
            rush.frequency.exponentialRampToValueAtTime(150, end);
            sources.forEach((source) => source.stop(end + 0.05));
            window.setTimeout(() => void audio.close(), (SPIN_DOWN_S + 0.2) * 1000);
        },
    };
}
