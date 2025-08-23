document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const patternsContainer = document.querySelector('.patterns-container');
    const playStopButton = document.getElementById('play-stop');
    const restartButton = document.getElementById('restart');
    const bpmInput = document.getElementById('bpm');
    const swingSlider = document.getElementById('swing');
    const swingValueDisplay = document.getElementById('swing-value');

    // --- Audio & Sequencer State ---
    let audioContext;
    let isPlaying = false;
    let currentStep = 0;
    let lastDrawStep = -1;
    let bpm = 120;
    let swing = 0.5;
    let nextStepTime = 0.0;
    let schedulerTimerID;
    let uiTimerID;

    // --- Pattern Data Structure ---
    const NUM_PATTERNS = 7;
    const NUM_STEPS = 64;
    const patterns = [];

    // --- Sound Synthesis ---
    function createKick(time) {
        if (!audioContext) return;
        const ampEnvelope = audioContext.createGain();
        ampEnvelope.connect(audioContext.destination);
        ampEnvelope.gain.setValueAtTime(1.0, time);
        ampEnvelope.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

        const carrier = audioContext.createOscillator();
        carrier.type = 'triangle';
        carrier.connect(ampEnvelope);

        const startPitch = 150;
        const endPitch = 40;
        carrier.frequency.setValueAtTime(startPitch, time);
        carrier.frequency.exponentialRampToValueAtTime(endPitch, time + 0.15);

        const modulator = audioContext.createOscillator();
        modulator.type = 'triangle';
        modulator.frequency.setValueAtTime(100, time);

        const modulatorGain = audioContext.createGain();
        modulatorGain.gain.setValueAtTime(250, time);
        modulatorGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        modulator.connect(modulatorGain);
        modulatorGain.connect(carrier.frequency);

        carrier.start(time);
        carrier.stop(time + 0.5);
        modulator.start(time);
        modulator.stop(time + 0.5);
    }

    // --- UI Generation & Handling ---
    function createPatternGrid() {
        for (let p = 0; p < NUM_PATTERNS; p++) {
            const row = document.createElement('div');
            row.classList.add('pattern-row');
            for (let s = 0; s < NUM_STEPS; s++) {
                const step = document.createElement('div');
                step.classList.add('step');
                step.dataset.pattern = p;
                step.dataset.step = s;
                if (patterns[p][s] === 1) {
                    step.classList.add('active');
                }
                row.appendChild(step);
            }
            patternsContainer.appendChild(row);
        }
    }

    function handleStepClick(event) {
        if (!event.target.classList.contains('step')) return;

        const pattern = parseInt(event.target.dataset.pattern, 10);
        const step = parseInt(event.target.dataset.step, 10);

        patterns[pattern][step] = patterns[pattern][step] === 1 ? 0 : 1;
        event.target.classList.toggle('active');
    }

    function updateUI() {
        if (lastDrawStep !== -1) {
            document.querySelectorAll(`.step[data-step='${lastDrawStep}']`).forEach(el => el.classList.remove('playing'));
        }

        // Use a different variable for drawing to avoid race conditions with scheduler
        const stepToDraw = (currentStep - 1 + NUM_STEPS) % NUM_STEPS;

        document.querySelectorAll(`.step[data-step='${stepToDraw}']`).forEach(el => el.classList.add('playing'));

        lastDrawStep = stepToDraw;

        // Keep UI update loop running
        if (isPlaying) {
            uiTimerID = setTimeout(updateUI, 1000 / 25); // ~25 FPS
        }
    }

    // --- Initialization ---
    function init() {
        for (let i = 0; i < NUM_PATTERNS; i++) {
            patterns[i] = new Array(NUM_STEPS).fill(0);
        }

        patterns[0][0] = 1; patterns[0][4] = 1; patterns[0][8] = 1; patterns[0][12] = 1;
        patterns[0][16] = 1; patterns[0][20] = 1; patterns[0][24] = 1; patterns[0][28] = 1;
        patterns[0][32] = 1; patterns[0][36] = 1; patterns[0][40] = 1; patterns[0][44] = 1;
        patterns[0][48] = 1; patterns[0][52] = 1; patterns[0][56] = 1; patterns[0][60] = 1;

        createPatternGrid();
        patternsContainer.addEventListener('click', handleStepClick);

        bpm = parseInt(bpmInput.value, 10);
        swing = parseInt(swingSlider.value, 10) / 100;
        swingSlider.addEventListener('input', (e) => { swingValueDisplay.textContent = `${e.target.value}%`; swing = parseInt(e.target.value, 10) / 100; });
        bpmInput.addEventListener('input', (e) => { bpm = parseInt(e.target.value, 10); });
        playStopButton.addEventListener('click', togglePlayback);
        restartButton.addEventListener('click', restartSequence);
        console.log('GUCCI DRUM Initialized.');
    }

    function setupAudioContext() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                alert('Web Audio API is not supported in this browser.');
            }
        }
    }

    // --- Sequencer Logic ---
    function scheduler() {
        while (nextStepTime < audioContext.currentTime + 0.1) {
            if (patterns[0][currentStep] === 1) {
                createKick(nextStepTime);
            }

            const secondsPerBeat = 60.0 / bpm;
            const sixteenthNoteDuration = secondsPerBeat / 4;

            if (currentStep % 2 !== 0) {
                nextStepTime += sixteenthNoteDuration * (1 + (swing - 0.5) * 2);
            } else {
                nextStepTime += sixteenthNoteDuration * (1 - (swing - 0.5) * 2);
            }

            currentStep = (currentStep + 1) % NUM_STEPS;
        }
        schedulerTimerID = setTimeout(scheduler, 25.0);
    }

    function togglePlayback() {
        setupAudioContext();
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        isPlaying = !isPlaying;
        if (isPlaying) {
            playStopButton.textContent = 'Stop';
            currentStep = 0;
            lastDrawStep = -1;
            nextStepTime = audioContext.currentTime;
            scheduler();
            updateUI(); // Start UI loop
        } else {
            playStopButton.textContent = 'Play';
            clearTimeout(schedulerTimerID);
            clearTimeout(uiTimerID);
            document.querySelectorAll('.step.playing').forEach(el => el.classList.remove('playing'));
        }
    }

    function restartSequence() {
        currentStep = 0;
        lastDrawStep = -1;
        if (isPlaying) {
           nextStepTime = audioContext.currentTime;
        }
    }

    init();
});
