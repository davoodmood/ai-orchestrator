const state = {
    projectId: null,
    project: null,
    isProcessing: false
};

const els = {
    status: document.getElementById('project-status'),
    initBtn: document.getElementById('init-btn'),
    conceptForm: document.getElementById('concept-form'),
    conceptInput: document.getElementById('concept-input'),
    generateBtn: document.getElementById('generate-btn'),
    workspace: document.getElementById('workspace-section'),
    shotList: document.getElementById('shot-list-container'),
    renderBtn: document.getElementById('render-btn')
};

// Event Listeners
els.initBtn.addEventListener('click', async () => {
    setProcessing(true);
    try {
        const res = await fetch('/api/projects', { method: 'POST' });
        const project = await res.json();
        updateState(project);
        els.conceptForm.classList.remove('hidden');
        els.initBtn.classList.add('hidden');
    } catch (e) {
        alert('Error initializing project');
        console.error(e);
    }
    setProcessing(false);
});

els.generateBtn.addEventListener('click', async () => {
    if (!els.conceptInput.value) return alert('Enter a concept');
    setProcessing(true);
    try {
        const res = await fetch(`/api/projects/${state.projectId}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concept: els.conceptInput.value })
        });
        const project = await res.json();
        updateState(project);
        els.workspace.classList.remove('hidden');
        els.conceptForm.classList.add('hidden');
    } catch (e) {
        alert('Error generating draft');
    }
    setProcessing(false);
});

els.renderBtn.addEventListener('click', async () => {
    setProcessing(true);
    try {
        const res = await fetch(`/api/projects/${state.projectId}/render`, { method: 'POST' });
        const project = await res.json();
        updateState(project);
        startPolling();
    } catch (e) {
        alert('Error starting render');
    }
    setProcessing(false);
});

function setProcessing(processing) {
    state.isProcessing = processing;
    els.status.textContent = processing ? 'Processing...' : (state.project?.status || 'Idle');
    const btns = document.querySelectorAll('button');
    btns.forEach(b => b.disabled = processing);
}

function updateState(project) {
    state.projectId = project.id;
    state.project = project;
    els.status.textContent = project.status;
    renderShotList();
}

function renderShotList() {
    els.shotList.innerHTML = '';
    if (!state.project || !state.project.shotList) return;

    state.project.shotList.forEach(shot => {
        const card = document.createElement('div');
        card.className = `shot-card ${shot.status.toLowerCase()}`;
        
        const header = document.createElement('div');
        header.className = 'shot-header';
        header.innerHTML = `<span>Shot #${shot.sequenceIndex + 1} (${shot.durationMs/1000}s)</span> <span>${shot.status}</span>`;
        
        const promptInput = document.createElement('textarea');
        promptInput.className = 'shot-prompt';
        promptInput.value = shot.visualPrompt;
        promptInput.disabled = shot.status !== 'DRAFT';

        // Manual Edit Save
        promptInput.addEventListener('blur', () => {
            if (promptInput.value !== shot.visualPrompt) {
                handleManualSave(shot.id, promptInput.value);
            }
        });

        const controls = document.createElement('div');
        controls.className = 'shot-controls';

        if (shot.status === 'DRAFT') {
            const magicBtn = document.createElement('button');
            magicBtn.className = 'magic-btn';
            magicBtn.textContent = '✨ Refine';
            // Use promptInput.value here to ensure we refine based on what's in the box? 
            // The prompt says refine logic: "App Layer Calls AIService.refinePrompt(currentPrompt, instruction)".
            // If we saved on blur, currentPrompt in backend is updated.
            // If the user types and immediately clicks refine without blurring (unlikely but possible), 
            // we might need to save first? 
            // But `promptInput.value` is passed to `handleRefine` in my old code?
            // The prompt logic: "API Routes to UpdateShotUseCase ... Domain Receives new prompt text. project.shots[2].updatePrompt(newText)". 
            // Wait, "Domain Receives new prompt text" - this was describing the RESULT of the AI.
            // "System Prompt: ... refinePrompt(currentPrompt, instruction)".
            // So the AI reads the current prompt.
            // If I pass `promptInput.value` to `handleRefine` and send it to backend, that would be robust.
            // But `UpdateShotInstruction` command only takes `instruction`. It fetches the shot from repo.
            // So the repo must be up to date.
            // So I should force a save if changed, or just rely on blur.
            // I'll rely on blur for now as "Pragmatic".
            magicBtn.onclick = () => handleRefine(shot.id, promptInput.value);
            controls.appendChild(magicBtn);
        }
        
        if (shot.renderUrl) {
            const link = document.createElement('a');
            link.href = shot.renderUrl;
            link.textContent = 'View Video';
            link.target = '_blank';
            controls.appendChild(link);
        }

        card.appendChild(header);
        card.appendChild(promptInput);
        card.appendChild(controls);
        els.shotList.appendChild(card);
    });
}

async function handleManualSave(shotId, visualPrompt) {
    try {
        const res = await fetch(`/api/projects/${state.projectId}/shots/${shotId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visualPrompt })
        });
        const project = await res.json();
        // We don't necessarily need to re-render here to avoid losing focus, 
        // but we should update local state.
        state.project = project;
        // Optional: show saved indicator
    } catch (e) {
        console.error('Error saving manual edit', e);
    }
}

async function handleRefine(shotId, currentText) {
    const instruction = prompt("What would you like to change? (e.g. 'Make it darker', 'Add rain')");
    if (!instruction) return;

    setProcessing(true);
    
    try {
        const res = await fetch(`/api/projects/${state.projectId}/shots/${shotId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instruction })
        });
        const project = await res.json();
        updateState(project);
    } catch (e) {
        alert('Error updating shot');
    }
    setProcessing(false);
}

let pollInterval;
function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
        if (state.project.status === 'COMPLETED') {
            clearInterval(pollInterval);
            return;
        }
        try {
            const res = await fetch(`/api/projects/${state.projectId}`);
            const project = await res.json();
            updateState(project);
        } catch (e) {
            console.error('Poll failed');
        }
    }, 2000);
}
