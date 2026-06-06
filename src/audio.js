/**
 * audio.js — Lightweight Web Audio API Synthesizer
 * Zero dependencies, zero network requests, 100% generated sounds.
 */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isMuted = localStorage.getItem('quizleris_muted') === 'true';

export function toggleMute() {
    isMuted = !isMuted;
    localStorage.setItem('quizleris_muted', isMuted);
    return isMuted;
}

export function getIsMuted() {
    return isMuted;
}

// Ensure AudioContext is running (browsers suspend it until user interaction)
function resumeCtx() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// ── Synth Helpers ──

function playTone(freq, type, duration, vol = 0.1, slideFreq = null) {
    if (isMuted) return;
    resumeCtx();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    if (slideFreq) {
        osc.frequency.exponentialRampToValueAtTime(slideFreq, audioCtx.currentTime + duration);
    }

    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// ── Sound Effects ──

export function playClick() {
    playTone(600, 'sine', 0.05, 0.05);
}

export function playCorrect(multiplier = 1) {
    // Base frequency goes up slightly with multiplier
    const baseFreq = 523.25; // C5
    const pitch = baseFreq * Math.pow(1.05, Math.min(multiplier - 1, 10)); 
    
    // Play a happy major chord arpeggio
    playTone(pitch, 'sine', 0.15, 0.1);
    setTimeout(() => playTone(pitch * 1.25, 'sine', 0.2, 0.1), 80);
    setTimeout(() => playTone(pitch * 1.5, 'sine', 0.4, 0.15), 160);
}

export function playWrong() {
    // Harsh, dissonant low buzzer
    playTone(150, 'sawtooth', 0.3, 0.1, 100);
    playTone(155, 'square', 0.3, 0.1, 105);
}

export function playLevelUp() {
    if (isMuted) return;
    resumeCtx();
    
    // Fanfare
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C, E, G, C (higher)
    notes.forEach((freq, i) => {
        setTimeout(() => playTone(freq, 'sine', 0.3, 0.15), i * 150);
    });
    setTimeout(() => playTone(1046.50, 'sine', 0.8, 0.2), notes.length * 150);
}

export function playFrenzyTick() {
    // High pitched short tick for shrinking timer urgency
    playTone(1200, 'triangle', 0.05, 0.02);
}
