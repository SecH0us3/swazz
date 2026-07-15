document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const toggleRecord = document.getElementById('btn-toggle-record');
    const recordPulse = document.getElementById('recording-pulse');
    const recordStatus = document.getElementById('recording-status');
    const toggleDescSub = document.getElementById('toggle-desc-sub');

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

    const btnSyncSwazz = document.getElementById('btn-sync-swazz');
    const syncStatus = document.getElementById('sync-status');
    const inputNewProjectName = document.getElementById('input-new-project-name');
    const btnCreateProject = document.getElementById('btn-create-project');
    const lblCreateProjectError = document.getElementById('lbl-create-project-error');

    let isRecording = false;
    let targetDomains = [];
    let capturedRequests = {};
    let activeToken = null;
    let activeSwazzUrl = "http://localhost:5173";
    let activeProjectId = null;
    let projectsList = [];

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
            'token', 
            'swazzUrl', 
            'projectId',
            'projectName',
            'syncCookies'
        ], (state) => {
            isRecording = !!state.recording;
            targetDomains = state.targetDomains || [];
            capturedRequests = state.capturedRequests || {};
            activeToken = state.token || null;
            activeSwazzUrl = state.swazzUrl || "http://localhost:5173";
            activeProjectId = state.projectId || null;

            // Sync toggle
            toggleRecord.checked = isRecording;
            updateRecordingUI();

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

            // Sync sync button disabled state
            updateSyncButtonState();

            // Render endpoints list
            renderEndpoints();

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

    // Toggle recording
    toggleRecord.addEventListener('change', (e) => {
        isRecording = e.target.checked;
        chrome.storage.local.set({ recording: isRecording });
        updateRecordingUI();
    });

    // Update domains in storage
    inputDomains.addEventListener('input', () => {
        const domains = inputDomains.value.split(',')
            .map(d => d.trim().toLowerCase())
            .filter(d => d.length > 0);
        targetDomains = domains;
        chrome.storage.local.set({ targetDomains: domains });
        cardActiveDomains.textContent = domains.length > 0 ? `Domains: ${domains.join(', ')}` : 'Scope: Empty';
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

            // Clear input
            inputNewProjectName.value = '';

            // Reload projects and select the newly created one
            await fetchProjects();
            
            // Set as active
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

            // Populate select list
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

            // Update active project name in storage if changed
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
                
                // Exclude chrome/extension settings pages
                if (tabUrl.protocol.startsWith('http')) {
                    helperCurrentTab.textContent = 'Suggest active tab: ';
                    const strong = document.createElement('strong');
                    strong.id = 'btn-add-host';
                    strong.style.cursor = 'pointer';
                    strong.style.textDecoration = 'underline';
                    strong.textContent = host;
                    helperCurrentTab.appendChild(strong);

                    strong.addEventListener('click', () => {
                        if (!targetDomains.includes(host)) {
                            targetDomains.push(host);
                            inputDomains.value = targetDomains.join(', ');
                            chrome.storage.local.set({ targetDomains });
                            cardActiveDomains.textContent = `Domains: ${targetDomains.join(', ')}`;
                            updateSyncButtonState();
                        }
                    });
                }
            } catch (e) {}
        }
    });

    // Clear recorded endpoints
    btnClearEndpoints.addEventListener('click', () => {
        if (confirm("Are you sure you want to clear all recorded endpoints?")) {
            capturedRequests = {};
            chrome.storage.local.set({ capturedRequests: {} });
            renderEndpoints();
        }
    });

    // Render list of captured endpoints
    function renderEndpoints() {
        const keys = Object.keys(capturedRequests);
        lblEndpointCount.textContent = keys.length;

        if (keys.length === 0) {
            emptyState.style.display = 'flex';
            endpointsList.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';
        endpointsList.innerHTML = '';

        // Sort by timestamp desc
        const sorted = keys.map(k => capturedRequests[k])
            .sort((a, b) => b.lastCaptured - a.lastCaptured);

        sorted.forEach(req => {
            const item = document.createElement('div');
            item.className = 'endpoint-item';

            const methodClass = req.method.toLowerCase();
            const statusClass = req.status || 'needs_work';
            const statusLabel = statusClass === 'well_covered' ? 'Covered' : 'Needs variations';

            const itemRow = document.createElement('div');
            itemRow.className = 'item-row';

            const itemMeta = document.createElement('div');
            itemMeta.className = 'item-meta';

            const methodBadge = document.createElement('span');
            methodBadge.className = `badge-method ${methodClass}`;
            methodBadge.textContent = req.method;

            const pathSpan = document.createElement('span');
            pathSpan.className = 'item-path';
            pathSpan.title = req.exampleUrl;
            pathSpan.textContent = req.path;

            itemMeta.appendChild(methodBadge);
            itemMeta.appendChild(pathSpan);

            const statusBadge = document.createElement('span');
            statusBadge.className = `badge-status ${statusClass}`;
            statusBadge.textContent = statusLabel;

            itemRow.appendChild(itemMeta);
            itemRow.appendChild(statusBadge);
            item.appendChild(itemRow);

            if (req.recommendation) {
                const rec = document.createElement('div');
                rec.className = 'item-recommendation';
                rec.textContent = req.recommendation;
                item.appendChild(rec);
            }

            endpointsList.appendChild(item);
        });
    }

    // Check if we can enable Sync button
    function updateSyncButtonState() {
        const hasProject = !!activeProjectId;
        const hasToken = !!activeToken;
        const hasEndpoints = Object.keys(capturedRequests).length > 0;

        btnSyncSwazz.disabled = !(hasProject && hasToken && hasEndpoints);
    }

    // Sync to Swazz Dashboard action
    btnSyncSwazz.addEventListener('click', async () => {
        if (!activeProjectId || !activeToken) return;

        btnSyncSwazz.disabled = true;
        showSyncStatus("Generating HAR log...", "info");

        // 1. Build standard HAR payload from captured requests
        const harPayload = buildHarPayload(capturedRequests);

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
                    // Update schema and params if matched
                    mergedEndpoints[matchIndex] = mergeEndpointDefs(mergedEndpoints[matchIndex], newEp);
                } else {
                    mergedEndpoints.push(newEp);
                }
            });

            currentConfig.endpoints = mergedEndpoints;

            // Auto-fill base_url and swagger_url from the captured traffic domain
            // so the runner can start scanning without manual configuration
            let capturedBaseUrl = parseData.basePath || null;
            if (!capturedBaseUrl) {
                // Fall back to the first target domain if parser didn't return basePath
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
                // swagger_url is required by the runner to start a scan.
                // If not already set, point it to the base URL so the runner
                // has a valid target. The user can override it to an actual
                // OpenAPI spec URL in project settings.
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
        // Merge request body schema properties
        const mergedSchema = { ...oldEp.schema };
        if (newEp.schema && newEp.schema.properties) {
            mergedSchema.properties = {
                ...(oldEp.schema?.properties || {}),
                ...newEp.schema.properties
            };
            mergedSchema.type = "object";
        }

        // Merge headers, query params, etc.
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

    // Helper to build standard HAR log structure from captured requests
    function buildHarPayload(requestsMap) {
        const entries = [];
        const keys = Object.keys(requestsMap);

        keys.forEach(k => {
            const req = requestsMap[k];
            try {
                const urlObj = new URL(req.exampleUrl);

                // Construct standard query string items
                const queryParams = [];
                urlObj.searchParams.forEach((value, name) => {
                    queryParams.push({ name, value });
                });

                // Map headers
                const headerItems = Object.entries(req.headers || {}).map(([name, value]) => ({ name, value }));
                // Parse common content types
                let mimeType = "application/json";
                
                // Generate entries for each unique body or query variation captured
                // This tells the Go parser to look at all forms of the request!
                const bodyList = req.bodyVariations.length > 0 ? req.bodyVariations : [""];
                const queryList = req.queryVariations.length > 0 ? req.queryVariations : [urlObj.search];

                queryList.forEach(q => {
                    bodyList.forEach(b => {
                        const variantUrl = new URL(urlObj.origin + urlObj.pathname + q);
                        const vQueryParams = [];
                        variantUrl.searchParams.forEach((val, name) => {
                            vQueryParams.push({ name, value: val });
                        });

                        entries.push({
                            startedDateTime: new Date(req.lastCaptured).toISOString(),
                            time: 10,
                            request: {
                                method: req.method,
                                url: variantUrl.href,
                                httpVersion: "HTTP/1.1",
                                cookies: [],
                                headers: headerItems,
                                queryString: vQueryParams,
                                postData: b ? {
                                    mimeType: mimeType,
                                    text: b
                                } : undefined,
                                headersSize: -1,
                                bodySize: b ? b.length : -1
                            },
                            response: {
                                status: 200,
                                statusText: "OK",
                                httpVersion: "HTTP/1.1",
                                cookies: [],
                                headers: [],
                                content: { size: 0, mimeType: "application/json" },
                                redirectURL: "",
                                headersSize: -1,
                                bodySize: -1
                            },
                            cache: {},
                            timings: { send: 0, wait: 10, receive: 0 }
                        });
                    });
                });
            } catch (e) {
                console.error("Skipping malformed URL during HAR generation:", req.exampleUrl, e);
            }
        });

        return {
            log: {
                version: "1.2",
                creator: {
                    name: "Swazz Extension Capturer",
                    version: "1.0.0"
                },
                entries: entries
            }
        };
    }

    // Set up chrome storage listener for live updates
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.capturedRequests) {
            capturedRequests = changes.capturedRequests.newValue || {};
            renderEndpoints();
            updateSyncButtonState();
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
    });

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
