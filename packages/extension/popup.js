document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const toggleRecord = document.getElementById('btn-toggle-record');
    const recordPulse = document.getElementById('recording-pulse');
    const recordStatus = document.getElementById('recording-status');
    const toggleDescSub = document.getElementById('toggle-desc-sub');

    const linkOpenSidepanel = document.getElementById('link-open-sidepanel');
    const scopeWarningBox = document.getElementById('scope-warning-box');
    const scopeWarningText = document.getElementById('scope-warning-text');
    const btnScopeWarningAction = document.getElementById('btn-scope-warning-action');

    const settingsToggle = document.getElementById('settings-toggle');
    const settingsContent = document.getElementById('settings-content');

    const inputSwazzUrl = document.getElementById('input-swazz-url');
    const inputToken = document.getElementById('input-token');
    const selectProject = document.getElementById('select-project');
    const btnRefreshProjects = document.getElementById('btn-refresh-projects');
    const inputDomains = document.getElementById('input-domains');
    const helperCurrentTab = document.getElementById('helper-current-tab');

    const cardActiveProject = document.getElementById('lbl-active-project');
    const cardActiveDomains = document.getElementById('lbl-active-domains');

    const emptyState = document.getElementById('empty-state');
    const endpointsList = document.getElementById('endpoints-list');
    const lblEndpointCount = document.getElementById('lbl-endpoint-count');
    const btnClearEndpoints = document.getElementById('btn-clear-endpoints');
    const btnImportHar = document.getElementById('btn-import-har');
    const inputImportHar = document.getElementById('input-import-har');

    const inputEndpointSearch = document.getElementById('input-endpoint-search');
    const chkSelectAll = document.getElementById('chk-select-all');
    const lblSelectedCount = document.getElementById('lbl-selected-count');

    const btnSyncSwazz = document.getElementById('btn-sync-swazz');
    const btnExportHar = document.getElementById('btn-export-har');
    const syncStatus = document.getElementById('sync-status');
    const inputNewProjectName = document.getElementById('input-new-project-name');
    const btnCreateProject = document.getElementById('btn-create-project');
    const lblCreateProjectError = document.getElementById('lbl-create-project-error');
    const btnCrawlTab = document.getElementById('btn-crawl-tab');
    const crawlStatusMsg = document.getElementById('crawl-status-msg');

    let isRecording = false;
    let targetDomains = [];
    let capturedRequests = {};
    let activeToken = null;
    let activeSwazzUrl = "http://localhost:5173";
    let activeProjectId = null;
    let projectsList = [];
    let droppedOutOfScope = 0;
    let droppedNoScope = 0;
    let lastDroppedHost = "";

    const selectedKeys = new Set();
    const unselectedKeys = new Set();
    const expandedKeys = new Set();
    let searchQuery = "";

    // Open in side panel (C5)
    if (linkOpenSidepanel) {
        linkOpenSidepanel.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const currentWindow = await chrome.windows.getCurrent();
                await chrome.sidePanel.open({ windowId: currentWindow.id });
                window.close();
            } catch (err) {
                console.error("Failed to open side panel:", err);
            }
        });
    }

    // Collapsible Settings
    settingsToggle.addEventListener('click', () => {
        settingsToggle.classList.toggle('open');
        settingsContent.classList.toggle('hidden');
    });

    // Load initial state
    function loadState() {
        chrome.storage.local.get([
            'recording', 
            'targetDomains', 
            'capturedRequests', 
            'droppedOutOfScope',
            'droppedNoScope',
            'lastDroppedHost',
            'token', 
            'swazzUrl', 
            'projectId',
            'projectName',
            'syncCookies',
            'crawlState'
        ], (state) => {
            isRecording = !!state.recording;
            targetDomains = state.targetDomains || [];
            capturedRequests = state.capturedRequests || {};
            droppedOutOfScope = state.droppedOutOfScope || 0;
            droppedNoScope = state.droppedNoScope || 0;
            lastDroppedHost = state.lastDroppedHost || "";
            updateCrawlUI(state.crawlState);
            activeToken = state.token || null;
            activeSwazzUrl = state.swazzUrl || "http://localhost:5173";
            activeProjectId = state.projectId || null;

            // Sync toggle
            toggleRecord.checked = isRecording;
            updateRecordingUI();
            updateScopeWarningUI();

            // Sync settings form
            inputSwazzUrl.value = activeSwazzUrl;
            inputToken.value = activeToken || '';
            inputDomains.value = targetDomains.join(', ');

            // Sync syncCookies preference
            const chkSyncCookies = document.getElementById('chk-sync-cookies');
            if (chkSyncCookies) {
                chkSyncCookies.checked = state.syncCookies !== false; // default to true
            }

            // Sync connection card
            cardActiveProject.textContent = state.projectName || (activeProjectId ? `Project ID: ${activeProjectId.slice(0, 8)}...` : 'None Selected');
            cardActiveDomains.textContent = targetDomains.length > 0 ? `Domains: ${targetDomains.join(', ')}` : 'Scope: Empty';

            // Render endpoints first: it seeds the default selection that the
            // Sync and HAR buttons key off, so updating them before this would
            // leave both disabled until the next storage change.
            renderEndpoints();

            // Sync sync & export buttons state
            updateSyncButtonState();

            // Load projects dropdown
            if (activeToken) {
                fetchProjects();
            }
        });
    }

    // Update UI for recording state
    function updateRecordingUI() {
        if (isRecording) {
            recordPulse.classList.add('active');
            recordStatus.textContent = 'Recording';
            recordStatus.style.color = 'var(--color-success)';
            toggleDescSub.textContent = 'Listening to traffic on targeted domains...';
        } else {
            recordPulse.classList.remove('active');
            recordStatus.textContent = 'Idle';
            recordStatus.style.color = 'var(--text-secondary)';
            toggleDescSub.textContent = 'Sniff API traffic on targeted domains';
        }
    }

    // Scope warning UI (C2)
    function updateScopeWarningUI() {
        if (!scopeWarningBox) return;

        if (isRecording && targetDomains.length === 0) {
            scopeWarningBox.classList.remove('hidden');
            scopeWarningText.textContent = "Recording is on but scope is empty — nothing will be captured";
            btnScopeWarningAction.textContent = "Use current tab";
            btnScopeWarningAction.onclick = () => {
                addActiveTabToScope();
            };
        } else if (droppedOutOfScope > 0) {
            scopeWarningBox.classList.remove('hidden');
            scopeWarningText.textContent = `${droppedOutOfScope} requests ignored (out of scope)`;
            const hostToAdd = lastDroppedHost || "";
            btnScopeWarningAction.textContent = hostToAdd ? `Add ${hostToAdd} to scope` : "Add to scope";
            btnScopeWarningAction.onclick = () => {
                if (hostToAdd) {
                    addDomainToScope(hostToAdd);
                }
            };
        } else {
            scopeWarningBox.classList.add('hidden');
        }
    }

    function addDomainToScope(host) {
        const clean = host.trim().toLowerCase();
        if (!clean) return;
        if (!targetDomains.includes(clean)) {
            targetDomains.push(clean);
            inputDomains.value = targetDomains.join(', ');
            cardActiveDomains.textContent = `Domains: ${targetDomains.join(', ')}`;
        }
        droppedOutOfScope = 0;
        lastDroppedHost = "";
        chrome.storage.local.set({
            targetDomains,
            droppedOutOfScope: 0,
            lastDroppedHost: ""
        });
        updateScopeWarningUI();
        updateSyncButtonState();
    }

    function addActiveTabToScope() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].url) {
                try {
                    const tabUrl = new URL(tabs[0].url);
                    if (tabUrl.protocol.startsWith('http')) {
                        addDomainToScope(tabUrl.host);
                    }
                } catch (e) {}
            }
        });
    }

    // Toggle recording
    toggleRecord.addEventListener('change', (e) => {
        isRecording = e.target.checked;
        chrome.storage.local.set({ recording: isRecording });
        updateRecordingUI();
        updateScopeWarningUI();
    });

    // Update domains in storage
    inputDomains.addEventListener('input', () => {
        const domains = inputDomains.value.split(',')
            .map(d => d.trim().toLowerCase())
            .filter(d => d.length > 0);
        targetDomains = domains;
        chrome.storage.local.set({ targetDomains: domains });
        cardActiveDomains.textContent = domains.length > 0 ? `Domains: ${domains.join(', ')}` : 'Scope: Empty';
        updateScopeWarningUI();
        updateSyncButtonState();
    });

    // Update Swazz URL
    inputSwazzUrl.addEventListener('change', () => {
        let url = inputSwazzUrl.value.trim();
        if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
        }
        activeSwazzUrl = url || "http://localhost:5173";
        chrome.storage.local.set({ swazzUrl: activeSwazzUrl });
        if (activeToken) fetchProjects();
    });

    // Update Token
    inputToken.addEventListener('change', () => {
        const token = inputToken.value.trim();
        activeToken = token || null;
        chrome.storage.local.set({ token: activeToken });
        updateSyncButtonState();
        if (activeToken) fetchProjects();
    });

    // Update active project
    selectProject.addEventListener('change', () => {
        const selectedId = selectProject.value;
        const selectedProj = projectsList.find(p => p.id === selectedId);
        activeProjectId = selectedId || null;
        
        const updates = { projectId: activeProjectId };
        if (selectedProj) {
            updates.projectName = selectedProj.name;
            cardActiveProject.textContent = selectedProj.name;
        } else {
            updates.projectName = "";
            cardActiveProject.textContent = "None Selected";
        }
        chrome.storage.local.set(updates);
        updateSyncButtonState();
    });

    // Refresh projects list
    btnRefreshProjects.addEventListener('click', () => {
        fetchProjects();
    });

    // Create new project
    btnCreateProject.addEventListener('click', async () => {
        lblCreateProjectError.textContent = '';
        const projName = inputNewProjectName.value.trim();
        if (!projName) {
            lblCreateProjectError.textContent = 'Project name is required';
            return;
        }
        if (!activeToken) {
            lblCreateProjectError.textContent = 'API Auth Token is required to create projects';
            return;
        }

        btnCreateProject.textContent = 'Creating...';
        btnCreateProject.disabled = true;
        inputNewProjectName.disabled = true;

        try {
            const res = await fetch(`${activeSwazzUrl}/api/projects`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeToken}`
                },
                body: JSON.stringify({
                    name: projName,
                    description: 'Created via Swazz Browser Extension'
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            const newProjectId = data.id;

            inputNewProjectName.value = '';
            await fetchProjects();
            
            activeProjectId = newProjectId;
            selectProject.value = newProjectId;
            
            const updates = { 
                projectId: newProjectId,
                projectName: projName
            };
            cardActiveProject.textContent = projName;
            chrome.storage.local.set(updates);
            updateSyncButtonState();

        } catch (err) {
            console.error("Failed to create project", err);
            lblCreateProjectError.textContent = err.message || 'Failed to create project';
        } finally {
            btnCreateProject.textContent = '➕ Create';
            btnCreateProject.disabled = false;
            inputNewProjectName.disabled = false;
        }
    });

    // Fetch projects from Swazz backend
    async function fetchProjects() {
        if (!activeToken) return;
        
        btnRefreshProjects.textContent = 'Loading...';
        btnRefreshProjects.disabled = true;

        try {
            const res = await fetch(`${activeSwazzUrl}/api/projects`, {
                headers: {
                    'Authorization': `Bearer ${activeToken}`
                }
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            projectsList = data.projects || [];

            selectProject.innerHTML = '<option value="">-- Select Swazz Project --</option>';
            projectsList.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === activeProjectId) {
                    opt.selected = true;
                }
                selectProject.appendChild(opt);
            });

            if (activeProjectId) {
                const activeP = projectsList.find(p => p.id === activeProjectId);
                if (activeP) {
                    chrome.storage.local.set({ projectName: activeP.name });
                    cardActiveProject.textContent = activeP.name;
                }
            }

            btnRefreshProjects.textContent = '🔄 Refresh Projects';
        } catch (err) {
            console.error("Failed to load projects", err);
            btnRefreshProjects.textContent = '❌ Failed to load';
        } finally {
            btnRefreshProjects.disabled = false;
        }
    }

    // Auto-detect current active tab and suggest adding its domain
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            try {
                const tabUrl = new URL(tabs[0].url);
                const host = tabUrl.host;
                
                if (tabUrl.protocol.startsWith('http')) {
                    helperCurrentTab.textContent = 'Suggest active tab: ';
                    const strong = document.createElement('strong');
                    strong.id = 'btn-add-host';
                    strong.style.cursor = 'pointer';
                    strong.style.textDecoration = 'underline';
                    strong.textContent = host;
                    helperCurrentTab.appendChild(strong);

                    strong.addEventListener('click', () => {
                        addDomainToScope(host);
                    });
                }
            } catch (e) {}
        }
    });

    // Clear recorded endpoints
    btnClearEndpoints.addEventListener('click', () => {
        if (confirm("Are you sure you want to clear all recorded endpoints?")) {
            capturedRequests = {};
            selectedKeys.clear();
            unselectedKeys.clear();
            expandedKeys.clear();
            droppedOutOfScope = 0;
            droppedNoScope = 0;
            lastDroppedHost = "";
            chrome.storage.local.set({
                capturedRequests: {},
                droppedOutOfScope: 0,
                droppedNoScope: 0,
                lastDroppedHost: ""
            });
            renderEndpoints();
            updateScopeWarningUI();
            updateSyncButtonState();
        }
    });

    // Helper to get selected captured requests map (C3)
    function getSelectedRequests() {
        const selected = {};
        for (const k of Object.keys(capturedRequests)) {
            if (selectedKeys.has(k)) {
                selected[k] = capturedRequests[k];
            }
        }
        return selected;
    }

    // Search filter input (C3)
    if (inputEndpointSearch) {
        inputEndpointSearch.addEventListener('input', (e) => {
            searchQuery = (e.target.value || '').toLowerCase().trim();
            renderEndpoints();
        });
    }

    // Select all checkbox (C3)
    if (chkSelectAll) {
        chkSelectAll.addEventListener('change', () => {
            const allKeys = Object.keys(capturedRequests);
            if (chkSelectAll.checked) {
                allKeys.forEach(k => {
                    selectedKeys.add(k);
                    unselectedKeys.delete(k);
                });
            } else {
                allKeys.forEach(k => {
                    selectedKeys.delete(k);
                    unselectedKeys.add(k);
                });
            }
            renderEndpoints();
            updateSyncButtonState();
        });
    }

    // Render list of captured endpoints (C3, C4)
    function renderEndpoints() {
        const allKeys = Object.keys(capturedRequests);
        lblEndpointCount.textContent = allKeys.length;

        // Auto-select newly captured keys
        allKeys.forEach(k => {
            if (!unselectedKeys.has(k) && !selectedKeys.has(k)) {
                selectedKeys.add(k);
            }
        });

        // Filter keys by search query
        const filteredKeys = allKeys.filter(k => {
            if (!searchQuery) return true;
            const req = capturedRequests[k];
            if (!req) return false;
            const methodMatch = (req.method || '').toLowerCase().includes(searchQuery);
            const pathMatch = (req.path || '').toLowerCase().includes(searchQuery);
            return methodMatch || pathMatch;
        });

        let selectedCount = 0;
        allKeys.forEach(k => {
            if (selectedKeys.has(k)) selectedCount++;
        });
        if (lblSelectedCount) {
            lblSelectedCount.textContent = `(${selectedCount} selected)`;
        }

        if (chkSelectAll) {
            chkSelectAll.checked = allKeys.length > 0 && selectedCount === allKeys.length;
            chkSelectAll.indeterminate = selectedCount > 0 && selectedCount < allKeys.length;
        }

        if (allKeys.length === 0) {
            emptyState.style.display = 'flex';
            endpointsList.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';
        endpointsList.innerHTML = '';

        // Sort by timestamp desc
        const sorted = filteredKeys.map(k => capturedRequests[k])
            .sort((a, b) => (b.lastCaptured || 0) - (a.lastCaptured || 0));

        sorted.forEach(req => {
            const item = document.createElement('div');
            item.className = 'endpoint-item';

            const methodClass = (req.method || 'get').toLowerCase();
            const statusClass = req.status || 'needs_work';
            const statusLabel = statusClass === 'well_covered' ? 'Covered' : 'Needs variations';

            const itemRow = document.createElement('div');
            itemRow.className = 'item-row';

            const itemHeader = document.createElement('div');
            itemHeader.className = 'endpoint-item-header';

            // Checkbox (C3)
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'endpoint-select-chk';
            chk.checked = selectedKeys.has(req.key);
            chk.addEventListener('change', (e) => {
                e.stopPropagation();
                if (chk.checked) {
                    selectedKeys.add(req.key);
                    unselectedKeys.delete(req.key);
                } else {
                    selectedKeys.delete(req.key);
                    unselectedKeys.add(req.key);
                }
                renderEndpoints();
                updateSyncButtonState();
            });
            itemHeader.appendChild(chk);

            // Delete ✕ button (C3)
            const btnDel = document.createElement('button');
            btnDel.className = 'btn-delete-endpoint';
            btnDel.title = 'Delete endpoint';
            btnDel.textContent = '✕';
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                delete capturedRequests[req.key];
                selectedKeys.delete(req.key);
                unselectedKeys.delete(req.key);
                expandedKeys.delete(req.key);
                chrome.storage.local.set({ capturedRequests }, () => {
                    renderEndpoints();
                    updateSyncButtonState();
                });
            });
            itemHeader.appendChild(btnDel);

            // Expand/collapse arrow (C4)
            const expandToggle = document.createElement('span');
            expandToggle.className = 'endpoint-expand-toggle' + (expandedKeys.has(req.key) ? ' open' : '');
            expandToggle.textContent = '▶';
            itemHeader.appendChild(expandToggle);

            const methodBadge = document.createElement('span');
            methodBadge.className = `badge-method ${methodClass}`;
            methodBadge.textContent = req.method;
            itemHeader.appendChild(methodBadge);

            const pathSpan = document.createElement('span');
            pathSpan.className = 'item-path';
            pathSpan.title = req.exampleUrl;
            pathSpan.textContent = req.path;
            itemHeader.appendChild(pathSpan);

            itemRow.appendChild(itemHeader);

            // Right side: status chips (C4) + coverage badge
            const rightSide = document.createElement('div');
            rightSide.style.display = 'flex';
            rightSide.style.alignItems = 'center';
            rightSide.style.gap = '6px';
            rightSide.style.flexShrink = '0';

            // Response status chips (C4)
            if (req.statuses && Object.keys(req.statuses).length > 0) {
                const chipsContainer = document.createElement('div');
                chipsContainer.className = 'status-chips-container';
                for (const sCode of Object.keys(req.statuses)) {
                    const sCount = req.statuses[sCode];
                    const chip = document.createElement('span');
                    const codeNum = parseInt(sCode, 10);
                    let chipClass = 'sother';
                    if (codeNum >= 200 && codeNum < 300) chipClass = 's2xx';
                    else if (codeNum >= 300 && codeNum < 400) chipClass = 's3xx';
                    else if (codeNum >= 400 && codeNum < 500) chipClass = 's4xx';
                    else if (codeNum >= 500) chipClass = 's5xx';

                    chip.className = `badge-status-chip ${chipClass}`;
                    chip.textContent = `${sCode} ×${sCount}`;
                    chipsContainer.appendChild(chip);
                }
                rightSide.appendChild(chipsContainer);
            }

            const statusBadge = document.createElement('span');
            statusBadge.className = `badge-status ${statusClass}`;
            statusBadge.textContent = statusLabel;
            rightSide.appendChild(statusBadge);

            itemRow.appendChild(rightSide);
            item.appendChild(itemRow);

            // Row click toggles expansion
            itemRow.style.cursor = 'pointer';
            itemRow.addEventListener('click', (e) => {
                if (e.target === chk || e.target === btnDel) return;
                if (expandedKeys.has(req.key)) {
                    expandedKeys.delete(req.key);
                } else {
                    expandedKeys.add(req.key);
                }
                renderEndpoints();
            });

            // Recommendation string
            if (req.recommendation) {
                const rec = document.createElement('div');
                rec.className = 'item-recommendation';
                rec.textContent = req.recommendation;
                item.appendChild(rec);
            }

            // Expandable details (C4)
            const isExpanded = expandedKeys.has(req.key);
            const detailsContainer = document.createElement('div');
            detailsContainer.className = 'item-expandable-details' + (isExpanded ? '' : ' hidden');

            // Query keys
            const queryKeysSection = document.createElement('div');
            queryKeysSection.className = 'item-detail-section';
            const qkLabel = document.createElement('span');
            qkLabel.className = 'item-detail-label';
            qkLabel.textContent = `Captured Query Parameters (${(req.queryKeys || []).length}):`;
            const qkValue = document.createElement('div');
            qkValue.className = 'item-detail-value';
            qkValue.textContent = (req.queryKeys && req.queryKeys.length > 0) ? req.queryKeys.join(', ') : '(none)';
            queryKeysSection.appendChild(qkLabel);
            queryKeysSection.appendChild(qkValue);
            detailsContainer.appendChild(queryKeysSection);

            // Body sample
            const bodySample = (req.bodyVariations && req.bodyVariations.length > 0) ? req.bodyVariations[0] : (req.lastResponse && req.lastResponse.bodySample ? req.lastResponse.bodySample : "");
            if (bodySample) {
                const bodySection = document.createElement('div');
                bodySection.className = 'item-detail-section';
                const bodyLabel = document.createElement('span');
                bodyLabel.className = 'item-detail-label';
                bodyLabel.textContent = 'Body Sample:';
                const bodyValue = document.createElement('div');
                bodyValue.className = 'item-detail-value';
                bodyValue.textContent = bodySample.length > 500 ? bodySample.slice(0, 500) + '...' : bodySample;
                bodySection.appendChild(bodyLabel);
                bodySection.appendChild(bodyValue);
                detailsContainer.appendChild(bodySection);
            }

            item.appendChild(detailsContainer);
            endpointsList.appendChild(item);
        });
    }

    // Check if we can enable Sync and Export buttons (A3, C3)
    function updateSyncButtonState() {
        const hasProject = !!activeProjectId;
        const hasToken = !!activeToken;
        const selectedMap = getSelectedRequests();
        const selectedCount = Object.keys(selectedMap).length;
        const hasSelected = selectedCount > 0;

        btnSyncSwazz.disabled = !(hasProject && hasToken && hasSelected);
        if (btnExportHar) {
            btnExportHar.disabled = !hasSelected;
        }
    }

    // HAR Export Action (A2, A3, C3)
    if (btnExportHar) {
        btnExportHar.addEventListener('click', () => {
            const selectedMap = getSelectedRequests();
            const reqCount = Object.keys(selectedMap).length;
            if (reqCount === 0) {
                showSyncStatus("No endpoints selected to export.", "error");
                return;
            }

            try {
                const result = window.SwazzHar.downloadHar(selectedMap, targetDomains);
                showSyncStatus(`⬇ Exported ${result.entries} requests → ${result.filename}`, "success");
            } catch (err) {
                console.error("HAR export failed:", err);
                showSyncStatus(`❌ Export error: ${err.message}`, "error");
            }
        });
    }

    // HAR Import Action (A4)
    if (btnImportHar && inputImportHar) {
        btnImportHar.addEventListener('click', () => {
            inputImportHar.click();
        });

        inputImportHar.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const importedMap = window.SwazzHar.parseHarIntoRequests(reader.result);
                    const importedKeys = Object.keys(importedMap);
                    if (importedKeys.length === 0) {
                        showSyncStatus("No endpoints found in HAR.", "error");
                        return;
                    }

                    const merged = window.SwazzHar.mergeCapturedRequests(capturedRequests, importedMap);
                    capturedRequests = merged;
                    importedKeys.forEach(k => {
                        selectedKeys.add(k);
                        unselectedKeys.delete(k);
                    });

                    chrome.storage.local.set({ capturedRequests: merged }, () => {
                        renderEndpoints();
                        updateSyncButtonState();
                        showSyncStatus(`📂 Imported ${importedKeys.length} endpoints from HAR!`, "success");
                    });
                } catch (err) {
                    console.error("HAR import failed:", err);
                    showSyncStatus(`❌ Import error: ${err.message}`, "error");
                } finally {
                    inputImportHar.value = '';
                }
            };
            reader.onerror = () => {
                showSyncStatus("❌ Failed to read HAR file.", "error");
                inputImportHar.value = '';
            };
            reader.readAsText(file);
        });
    }

    // Sync to Swazz Dashboard action (acting on selected subset, C3)
    btnSyncSwazz.addEventListener('click', async () => {
        if (!activeProjectId || !activeToken) return;

        const selectedMap = getSelectedRequests();
        const reqCount = Object.keys(selectedMap).length;
        if (reqCount === 0) {
            showSyncStatus("No endpoints selected to sync.", "error");
            return;
        }

        if (reqCount > 5000) {
            const proceed = confirm(`Warning: You have selected ${reqCount} requests. Exporting more than 5000 requests may result in slow parsing or timeouts. Do you want to proceed?`);
            if (!proceed) {
                showSyncStatus("Sync cancelled.", "info");
                return;
            }
        }

        btnSyncSwazz.disabled = true;
        showSyncStatus("Generating HAR log...", "info");

        // 1. Build standard HAR payload from selected requests
        const harPayload = window.SwazzHar.buildHarPayload(selectedMap);

        try {
            // 2. Parse HAR payload into Swazz Endpoints using coordinator
            showSyncStatus("Parsing traffic log via Swazz...", "info");
            const parseRes = await fetch(`${activeSwazzUrl}/api/parse`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeToken}`
                },
                body: JSON.stringify({
                    rawSpec: JSON.stringify(harPayload)
                })
            });

            if (!parseRes.ok) {
                const parseErr = await parseRes.json().catch(() => ({ error: parseRes.statusText }));
                throw new Error(`Parse failed: ${parseErr.error || parseRes.statusText}`);
            }

            const parseData = await parseRes.json();
            const parsedEndpoints = parseData.endpoints || [];

            if (parsedEndpoints.length === 0) {
                throw new Error("No endpoints parsed from captured traffic.");
            }

            // 3. Fetch current project configuration
            showSyncStatus("Merging with existing project config...", "info");
            const configRes = await fetch(`${activeSwazzUrl}/api/projects/${activeProjectId}/config`, {
                headers: {
                    'Authorization': `Bearer ${activeToken}`
                }
            });

            if (!configRes.ok) throw new Error("Failed to retrieve project configuration.");
            const currentConfig = await configRes.json();

            // 4. Merge new endpoints into existing config
            const existingEndpoints = currentConfig.endpoints || [];
            const mergedEndpoints = [...existingEndpoints];

            parsedEndpoints.forEach(newEp => {
                const matchIndex = mergedEndpoints.findIndex(existingEp => 
                    existingEp.method.toUpperCase() === newEp.method.toUpperCase() && 
                    existingEp.path === newEp.path
                );

                if (matchIndex >= 0) {
                    mergedEndpoints[matchIndex] = mergeEndpointDefs(mergedEndpoints[matchIndex], newEp);
                } else {
                    mergedEndpoints.push(newEp);
                }
            });

            currentConfig.endpoints = mergedEndpoints;

            let capturedBaseUrl = parseData.basePath || null;
            if (!capturedBaseUrl) {
                try {
                    const stored = await new Promise(r => chrome.storage.local.get(['targetDomains'], r));
                    const domains = stored.targetDomains || [];
                    if (domains.length > 0) capturedBaseUrl = `https://${domains[0]}`;
                } catch {}
            }

            if (capturedBaseUrl) {
                if (!currentConfig.base_url) {
                    currentConfig.base_url = capturedBaseUrl;
                }
                if (!currentConfig.swagger_url) {
                    currentConfig.swagger_url = capturedBaseUrl;
                }
            }

            // Sync active cookies if selected
            const chkSyncCookies = document.getElementById('chk-sync-cookies');
            if (chkSyncCookies && chkSyncCookies.checked) {
                showSyncStatus("Gathering active session cookies...", "info");
                const cookieMap = {};
                for (const domain of targetDomains) {
                    try {
                        const cookies = await getDomainCookies(domain);
                        cookies.forEach(c => {
                            cookieMap[c.name] = c.value;
                        });
                    } catch (e) {
                        console.error("Failed to fetch cookies for domain:", domain, e);
                    }
                }
                if (Object.keys(cookieMap).length > 0) {
                    currentConfig.cookies = {
                        ...(currentConfig.cookies || {}),
                        ...cookieMap
                    };
                }
            }

            // 5. Save updated configuration back to Swazz
            showSyncStatus("Saving scan configuration...", "info");
            const saveRes = await fetch(`${activeSwazzUrl}/api/projects/${activeProjectId}/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${activeToken}`
                },
                body: JSON.stringify({ config: currentConfig })
            });

            if (!saveRes.ok) throw new Error("Failed to save merged configuration.");

            showSyncStatus(`✅ Successfully synced ${parsedEndpoints.length} endpoints!`, "success");
        } catch (err) {
            console.error("Sync failed:", err);
            showSyncStatus(`❌ Sync error: ${err.message}`, "error");
        } finally {
            btnSyncSwazz.disabled = false;
        }
    });

    function showSyncStatus(msg, type) {
        syncStatus.textContent = msg;
        syncStatus.className = 'sync-status ' + type;
    }

    // Helper to merge endpoint definitions
    function mergeEndpointDefs(oldEp, newEp) {
        const mergedSchema = { ...oldEp.schema };
        if (newEp.schema && newEp.schema.properties) {
            mergedSchema.properties = {
                ...(oldEp.schema?.properties || {}),
                ...newEp.schema.properties
            };
            mergedSchema.type = "object";
        }

        return {
            ...oldEp,
            schema: mergedSchema,
            queryParams: {
                ...(oldEp.queryParams || {}),
                ...(newEp.queryParams || {})
            },
            headerParams: {
                ...(oldEp.headerParams || {}),
                ...(newEp.headerParams || {})
            }
        };
    }

    // Storage listener for live updates
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.capturedRequests) {
            capturedRequests = changes.capturedRequests.newValue || {};
            renderEndpoints();
            updateSyncButtonState();
        }
        if (changes.recording) {
            isRecording = !!changes.recording.newValue;
            toggleRecord.checked = isRecording;
            updateRecordingUI();
            updateScopeWarningUI();
        }
        if (changes.targetDomains) {
            targetDomains = changes.targetDomains.newValue || [];
            inputDomains.value = targetDomains.join(', ');
            cardActiveDomains.textContent = targetDomains.length > 0 ? `Domains: ${targetDomains.join(', ')}` : 'Scope: Empty';
            updateScopeWarningUI();
            updateSyncButtonState();
        }
        if (changes.droppedOutOfScope !== undefined) {
            droppedOutOfScope = changes.droppedOutOfScope.newValue || 0;
            updateScopeWarningUI();
        }
        if (changes.lastDroppedHost !== undefined) {
            lastDroppedHost = changes.lastDroppedHost.newValue || "";
            updateScopeWarningUI();
        }
        if (changes.token || changes.swazzUrl) {
            loadState();
        }
        if (changes.projectId || changes.projectName) {
            chrome.storage.local.get(['projectId', 'projectName'], (state) => {
                activeProjectId = state.projectId || null;
                cardActiveProject.textContent = state.projectName || (activeProjectId ? `Project ID: ${activeProjectId.slice(0, 8)}...` : 'None Selected');
                updateSyncButtonState();
            });
        }
        if (changes.crawlState) {
            updateCrawlUI(changes.crawlState.newValue);
        }
    });

    // Crawl Active Tab Action
    if (btnCrawlTab) {
        btnCrawlTab.addEventListener('click', () => {
            chrome.storage.local.get(['crawlState'], (res) => {
                const isCurrentlyCrawling = res.crawlState && res.crawlState.crawling;
                
                if (isCurrentlyCrawling) {
                    const crawlState = res.crawlState || {};
                    crawlState.crawling = false;
                    chrome.storage.local.set({ crawlState }, () => {
                        showCrawlStatus("Crawl stopped by user.", "error");
                    });
                    return;
                }

                if (!isRecording) {
                    showCrawlStatus("Please enable Traffic Recording first!", "error");
                    return;
                }

                showCrawlStatus("Initiating crawl on active tab...", "info");
                btnCrawlTab.disabled = true;

                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (!tabs || tabs.length === 0) {
                        showCrawlStatus("No active tab found.", "error");
                        btnCrawlTab.disabled = false;
                        return;
                    }
                    const activeTab = tabs[0];
                    chrome.tabs.sendMessage(activeTab.id, { source: 'swazz-detector', type: 'start_crawl', tabId: activeTab.id }, (response) => {
                        if (chrome.runtime.lastError) {
                            showCrawlStatus("Could not communicate with tab. Make sure the page is fully loaded and refresh it.", "error");
                            btnCrawlTab.disabled = false;
                            return;
                        }
                        if (response && response.error) {
                            showCrawlStatus(response.error, "error");
                            btnCrawlTab.disabled = false;
                        } else if (response && response.success) {
                            showCrawlStatus("Crawling... Press Stop Crawl to finish early.", "info");
                        } else {
                            showCrawlStatus("Failed to start crawl. No response from tab.", "error");
                            btnCrawlTab.disabled = false;
                        }
                    });
                });
            });
        });
    }

    function showCrawlStatus(text, type = "info") {
        if (!crawlStatusMsg) return;
        crawlStatusMsg.textContent = text;
        crawlStatusMsg.className = `crawl-status-message ${type}`;
        crawlStatusMsg.classList.remove('hidden');
    }

    function updateCrawlUI(state) {
        if (!state) {
            if (btnCrawlTab) {
                btnCrawlTab.disabled = false;
                btnCrawlTab.textContent = "🕷 Crawl Tab";
            }
            if (crawlStatusMsg) crawlStatusMsg.classList.add('hidden');
            return;
        }

        if (state.crawling) {
            if (btnCrawlTab) {
                btnCrawlTab.disabled = false;
                btnCrawlTab.textContent = "🛑 Stop Crawl";
            }
            showCrawlStatus(`Crawling... Visited: ${state.stats.linksVisited}/${state.limit} links, Submitted: ${state.stats.formsSubmitted} forms`, "info");
        } else {
            if (btnCrawlTab) {
                btnCrawlTab.disabled = false;
                btnCrawlTab.textContent = "🕷 Crawl Tab";
            }
            if (state.stats && (state.stats.linksVisited > 0 || state.stats.formsSubmitted > 0)) {
                showCrawlStatus(`Crawl complete! Visited ${state.stats.linksVisited} links, Submitted ${state.stats.formsSubmitted} forms.`, "success");
            } else {
                if (crawlStatusMsg) crawlStatusMsg.classList.add('hidden');
            }
        }
    }

    // Sync cookies checkbox listener
    const chkSyncCookies = document.getElementById('chk-sync-cookies');
    if (chkSyncCookies) {
        chkSyncCookies.addEventListener('change', () => {
            chrome.storage.local.set({ syncCookies: chkSyncCookies.checked });
        });
    }

    function getDomainCookies(domain) {
        const cleanDomain = domain.split(':')[0];
        return new Promise((resolve) => {
            if (!chrome.cookies) {
                console.warn("chrome.cookies API not available");
                return resolve([]);
            }
            chrome.cookies.getAll({ domain: cleanDomain }, (cookies) => {
                resolve(cookies || []);
            });
        });
    }

    // Initial load
    loadState();
});
