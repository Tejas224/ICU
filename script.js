document.addEventListener("DOMContentLoaded", () => {
    let patients = [];
    let alerts = [];
    const agentFeed = [];
    let selectedPatientId = null;
    let apiConfig = {
        apiEnabled: false,
        provider: "demo",
        model: null
    };

    function generateAccessCode() {
        return Math.random().toString(36).slice(2, 8).toUpperCase();
    }

    function getPatientById(patientId) {
        return patients.find((patient) => patient.id === patientId);
    }

    async function fetchPatients() {
        const response = await fetch("/api/patients");
        if (!response.ok) {
            throw new Error("Could not load patients.");
        }

        const result = await response.json();
        patients = result.patients.map((patient) => ({
            ...patient,
            approvedPhone: patient.approvedPhone || "",
            accessCode: patient.accessCode || generateAccessCode(),
            codeExpiresAt: patient.codeExpiresAt || Date.now() + 10 * 60 * 1000,
            history: patient.history || [],
            lastAutoTriageSnapshot: null
        }));
    }

    async function syncPatients() {
        await fetch("/api/patients/sync", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ patients })
        });
    }

    function getVitalStatusClass(vitalName, value) {
        if (vitalName === "heartRate") {
            if (value > 110 || value < 55) return "vital-danger";
            if (value > 100 || value < 60) return "vital-warning";
            return "vital-normal";
        }

        if (vitalName === "oxygen") {
            if (value < 92) return "vital-danger";
            if (value < 95) return "vital-warning";
            return "vital-normal";
        }

        return "";
    }

    function maskPhoneNumber(phone) {
        if (!phone || phone.length < 4) return "***";
        return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
    }

    function evaluateRisk(patient) {
        const hrDanger = patient.heartRate > 110 || patient.heartRate < 55;
        const oxygenDanger = patient.oxygen < 92;
        const hrWarn = patient.heartRate > 100 || patient.heartRate < 60;
        const oxygenWarn = patient.oxygen < 95;

        if (hrDanger || oxygenDanger) return "High";
        if (hrWarn || oxygenWarn) return "Medium";
        return "Low";
    }

    function buildAgentRecommendation(patient) {
        const risk = evaluateRisk(patient);
        if (risk === "High") {
            return `Immediate review for ${patient.name}: verify airway, oxygen support, and call ICU physician.`;
        }
        if (risk === "Medium") {
            return `Observe ${patient.name} closely: repeat vitals in 5 minutes and assess trend.`;
        }
        return `${patient.name} is stable: continue routine monitoring.`;
    }

    function setApiStatus(message, isLive) {
        const status = document.getElementById("apiStatus");
        if (!status) return;
        status.textContent = message;
        status.className = `api-status ${isLive ? "api-live" : "api-demo"}`;
    }

    function setChatStatus(message, isLive) {
        const status = document.getElementById("chatStatus");
        if (!status) return;
        status.textContent = message;
        status.className = `api-status ${isLive ? "api-live" : "api-demo"}`;
    }

    function setRecommendationStatus(message, isLive) {
        const status = document.getElementById("recommendationStatus");
        if (!status) return;
        status.textContent = message;
        status.className = `api-status ${isLive ? "api-live" : "api-demo"}`;
    }

    function addAgentFeedEntry(patient, triageResult = null) {
        const derivedRisk = triageResult?.risk || evaluateRisk(patient);
        patient.aiRisk = derivedRisk;

        const entry = {
            time: new Date().toLocaleTimeString("en-US", { hour12: false }),
            patientName: patient.name,
            risk: derivedRisk,
            recommendation: triageResult?.summary || buildAgentRecommendation(patient),
            actions: triageResult?.actions || [],
            source: triageResult?.provider || triageResult?.mode || "local_rules"
        };

        agentFeed.unshift(entry);
        if (agentFeed.length > 16) {
            agentFeed.pop();
        }
    }

    function displayAgentFeed() {
        const feedContainer = document.getElementById("agentFeed");
        if (!feedContainer) return;

        if (agentFeed.length === 0) {
            feedContainer.innerHTML = "<li>No AI updates yet.</li>";
            return;
        }

        feedContainer.innerHTML = agentFeed.map((entry) => `
            <li class="risk-${entry.risk.toLowerCase()}">
                <strong>${entry.time}</strong> - ${entry.patientName} - <span>${entry.risk} Risk</span><br>
                ${entry.recommendation}
                ${entry.actions.length ? `<br>${entry.actions.map((action) => `- ${action}`).join("<br>")}` : ""}
                <div class="agent-source">Source: ${entry.source}</div>
            </li>
        `).join("");
    }

    async function loadApiConfig() {
        try {
            const response = await fetch("/api/config");
            if (!response.ok) {
                throw new Error("Could not load config.");
            }

            apiConfig = await response.json();
            if (apiConfig.apiEnabled) {
                setApiStatus(`Live ${apiConfig.provider} mode enabled (${apiConfig.model}).`, true);
                setChatStatus(`Patient assistant ready with ${apiConfig.provider}.`, true);
            } else {
                setApiStatus("Demo fallback mode. Add GEMINI_API_KEY or OPENAI_API_KEY for real AI.", false);
                setChatStatus("Patient assistant is in demo mode.", false);
            }
        } catch (error) {
            setApiStatus("Unable to detect API status. Using local demo mode.", false);
            setChatStatus("Patient assistant unavailable, using local demo mode.", false);
        }
    }

    function getPatientPayload(patient) {
        return {
            patient: {
                name: patient.name,
                age: patient.age,
                room: patient.room,
                heartRate: patient.heartRate,
                bloodPressure: patient.bloodPressure,
                oxygen: patient.oxygen,
                aiRisk: patient.aiRisk,
                treatmentPlan: patient.treatmentPlan
            },
            history: patient.history.slice(-6),
            alerts: alerts
                .filter((alert) => alert.message.startsWith(`${patient.name}:`))
                .map((alert) => alert.message)
        };
    }

    async function requestAITriage(patient) {
        const response = await fetch("/api/triage", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(getPatientPayload(patient))
        });

        if (!response.ok) {
            throw new Error(`Triage request failed for ${patient.name}.`);
        }

        return response.json();
    }

    async function runAITriageForAllPatients() {
        const button = document.getElementById("runTriageBtn");
        if (button) {
            button.disabled = true;
            button.textContent = "Running AI triage...";
        }

        try {
            checkVitalsForAlerts();

            for (const patient of patients) {
                const triageResult = await requestAITriage(patient);
                patient.aiRisk = triageResult.risk;
                patient.lastAutoTriageSnapshot = {
                    heartRate: patient.heartRate,
                    oxygen: patient.oxygen,
                    aiRisk: patient.aiRisk
                };
                addAgentFeedEntry(patient, triageResult);
            }

            displayPatientCards();
            displayAgentFeed();
            await syncPatients();
            setApiStatus(apiConfig.apiEnabled ? "Live API triage completed." : "Demo triage completed.", apiConfig.apiEnabled);
        } catch (error) {
            setApiStatus("AI triage failed. Review server/API configuration.", false);
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Run AI Triage For All Patients";
            }
        }
    }

    function displayPatientCards() {
        const patientCardsContainer = document.getElementById("patientCards");
        if (!patientCardsContainer) return;

        patientCardsContainer.innerHTML = "";
        patients.forEach((patient) => {
            const card = document.createElement("div");
            card.className = "patient-card";

            const hrClass = getVitalStatusClass("heartRate", patient.heartRate);
            const oxygenClass = getVitalStatusClass("oxygen", patient.oxygen);

            card.innerHTML = `
                <h3>${patient.name}</h3>
                <p>Age: ${patient.age}</p>
                <p>Room: ${patient.room}</p>
                <p>Heart Rate: <span class="${hrClass}">${patient.heartRate}</span> bpm</p>
                <p>Blood Pressure: ${patient.bloodPressure}</p>
                <p>Oxygen: <span class="${oxygenClass}">${patient.oxygen}</span>%</p>
                <p>AI Risk: <strong>${patient.aiRisk}</strong></p>
                <p class="secure-code">Approved Phone: ${maskPhoneNumber(patient.approvedPhone)}</p>
            `;
            patientCardsContainer.appendChild(card);
        });
    }

    function displayPatientList() {
        const patientList = document.getElementById("patientList");
        if (!patientList) return;

        patientList.innerHTML = patients.map((patient) => `
            <li><a href="#" data-patient-id="${patient.id}">${patient.name}</a></li>
        `).join("");

        attachPatientClickListeners();
    }

    function displayAlerts() {
        const alertList = document.getElementById("alertList");
        if (!alertList) return;

        if (alerts.length === 0) {
            alertList.innerHTML = '<li class="low">No active alerts.</li>';
            return;
        }

        alertList.innerHTML = alerts.map((alert) => `
            <li class="${alert.priority.toLowerCase()}">${alert.message}</li>
        `).join("");
    }

    function updateDateTime() {
        const dateTimeElement = document.getElementById("dateTime");
        if (!dateTimeElement) return;
        const now = new Date();
        dateTimeElement.textContent = now.toLocaleString("en-US", {
            dateStyle: "full",
            timeStyle: "medium"
        });
    }

    function displayPatientDetailsById(patientId) {
        const patient = getPatientById(patientId);
        const patientDetailsContainer = document.getElementById("patientDetails");
        if (!patientDetailsContainer) return;

        if (!patient) {
            patientDetailsContainer.innerHTML = "<p>Patient details not found.</p>";
            return;
        }

        selectedPatientId = patientId;
        patientDetailsContainer.innerHTML = `
            <h3>${patient.name}</h3>
            <p>Age: ${patient.age}</p>
            <p>Room: ${patient.room}</p>
            <p>Heart Rate: <span class="${getVitalStatusClass("heartRate", patient.heartRate)}">${patient.heartRate}</span> bpm</p>
            <p>Blood Pressure: ${patient.bloodPressure}</p>
            <p>Oxygen: <span class="${getVitalStatusClass("oxygen", patient.oxygen)}">${patient.oxygen}</span>%</p>
            <p>AI Recommendation: ${buildAgentRecommendation(patient)}</p>
            <p>Approved Phone: ${maskPhoneNumber(patient.approvedPhone)}</p>
            <button type="button" class="regen-code-btn" data-patient-id="${patient.id}">Generate New Access Code</button>
        `;

        const regenButton = patientDetailsContainer.querySelector(".regen-code-btn");
        if (regenButton) {
            regenButton.addEventListener("click", async () => {
                patient.accessCode = generateAccessCode();
                patient.codeExpiresAt = Date.now() + 10 * 60 * 1000;
                await syncPatients();
                const formStatus = document.getElementById("formStatus");
                if (formStatus) {
                    formStatus.textContent = `New code for ${patient.name}: ${patient.accessCode}. Share this for mobile access at /mobile.html.`;
                }
                displayPatientDetailsById(patient.id);
            });
        }
    }

    function displayPatientHistoryById(patientId) {
        const patient = getPatientById(patientId);
        const historyContainer = document.querySelector(".patient-history");
        if (!historyContainer) return;

        if (patient && patient.history.length > 0) {
            const historyHtml = [...patient.history].reverse().map((entry) => (
                `<li>${entry.time} - HR: ${entry.heartRate}, SpO2: ${entry.oxygen}%</li>`
            )).join("");

            historyContainer.innerHTML = `<h3>Patient History</h3><ul>${historyHtml}</ul>`;
        } else {
            historyContainer.innerHTML = "<h3>Patient History</h3><p>No history available.</p>";
        }
    }

    function displayTreatmentPlanById(patientId) {
        const patient = getPatientById(patientId);
        const planContainer = document.querySelector(".treatment-plans");
        if (!planContainer) return;

        if (patient) {
            planContainer.innerHTML = `<h3>Treatment Plan</h3><p>${patient.treatmentPlan}</p>`;
        } else {
            planContainer.innerHTML = "<h3>Treatment Plan</h3><p>Select a patient to view their plan.</p>";
        }
    }

    function attachPatientClickListeners() {
        const patientLinks = document.querySelectorAll("#patientList li a");
        patientLinks.forEach((link) => {
            link.addEventListener("click", (event) => {
                event.preventDefault();
                patientLinks.forEach((item) => item.classList.remove("active"));
                link.classList.add("active");

                const patientId = link.dataset.patientId;
                displayPatientDetailsById(patientId);
                displayPatientHistoryById(patientId);
                displayTreatmentPlanById(patientId);
                setChatStatus(`Selected ${link.textContent}. You can ask the AI assistant now.`, apiConfig.apiEnabled);
                setRecommendationStatus(`Selected ${link.textContent}. Request a health recommendation when ready.`, apiConfig.apiEnabled);
            });
        });
    }

    function checkVitalsForAlerts() {
        alerts = [];

        patients.forEach((patient) => {
            if (patient.heartRate > 110 || patient.heartRate < 55) {
                alerts.push({ message: `${patient.name}: Critical Heart Rate (${patient.heartRate} bpm)`, priority: "High" });
            } else if (patient.heartRate > 100 || patient.heartRate < 60) {
                alerts.push({ message: `${patient.name}: Abnormal Heart Rate (${patient.heartRate} bpm)`, priority: "Medium" });
            }

            if (patient.oxygen < 92) {
                alerts.push({ message: `${patient.name}: Oxygen Level Critical (${patient.oxygen}%)`, priority: "High" });
            } else if (patient.oxygen < 95) {
                alerts.push({ message: `${patient.name}: Oxygen Level Low (${patient.oxygen}%)`, priority: "Medium" });
            }
        });

        displayAlerts();
    }

    async function updatePhoneViewer() {
        const phone = document.getElementById("viewerPhone").value.trim();
        const code = document.getElementById("viewerCode").value.trim().toUpperCase();
        const viewerResult = document.getElementById("viewerResult");
        if (!viewerResult) return;

        try {
            const response = await fetch("/api/patient-access", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ phone, code })
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Access denied.");
            }

            const patient = result.patient;
            viewerResult.innerHTML = `
                <div class="phone-card">
                    <h3>${patient.name} (Room ${patient.room})</h3>
                    <p>Heart Rate: <span class="${getVitalStatusClass("heartRate", patient.heartRate)}">${patient.heartRate}</span> bpm</p>
                    <p>Blood Pressure: ${patient.bloodPressure}</p>
                    <p>Oxygen: <span class="${getVitalStatusClass("oxygen", patient.oxygen)}">${patient.oxygen}</span>%</p>
                    <p>AI Risk: <strong>${patient.aiRisk}</strong></p>
                    <p>Treatment Plan: ${patient.treatmentPlan}</p>
                </div>
            `;
        } catch (error) {
            viewerResult.innerHTML = `<p class="denied">${error.message}</p>`;
        }
    }

    function shouldAutoTriage(patient) {
        const previous = patient.lastAutoTriageSnapshot;
        if (!previous) {
            return true;
        }

        const oxygenDelta = Math.abs(patient.oxygen - previous.oxygen);
        const heartRateDelta = Math.abs(patient.heartRate - previous.heartRate);
        const riskChanged = patient.aiRisk !== previous.aiRisk;
        const oxygenCriticalCross = (previous.oxygen >= 92 && patient.oxygen < 92) || (previous.oxygen < 92 && patient.oxygen >= 92);
        const hrCriticalCross = (previous.heartRate <= 110 && patient.heartRate > 110) || (previous.heartRate >= 55 && patient.heartRate < 55);

        return riskChanged || oxygenDelta >= 3 || heartRateDelta >= 12 || oxygenCriticalCross || hrCriticalCross;
    }

    async function autoTriageChangedPatients() {
        checkVitalsForAlerts();
        const changedPatients = patients.filter(shouldAutoTriage);
        if (changedPatients.length === 0) {
            return;
        }

        for (const patient of changedPatients) {
            try {
                const triageResult = await requestAITriage(patient);
                patient.aiRisk = triageResult.risk;
                addAgentFeedEntry(patient, triageResult);
            } catch (error) {
                addAgentFeedEntry(patient);
            } finally {
                patient.lastAutoTriageSnapshot = {
                    heartRate: patient.heartRate,
                    oxygen: patient.oxygen,
                    aiRisk: patient.aiRisk
                };
                patient.lastUpdated = new Date().toLocaleString("en-US");
            }
        }

        displayPatientCards();
        displayAgentFeed();
        await syncPatients();
    }

    function renderChatAnswer(answer, metadata) {
        const container = document.getElementById("chatAnswer");
        if (!container) return;

        container.innerHTML = `
            <p>${answer}</p>
            <div class="agent-source">Source: ${metadata.provider || metadata.mode}${metadata.model ? ` (${metadata.model})` : ""}</div>
        `;
    }

    function renderRecommendationResult(result) {
        const container = document.getElementById("recommendationResult");
        if (!container) return;

        container.innerHTML = `
            <p><strong>Recommendation:</strong> ${result.recommendation}</p>
            <p><strong>Care Plan:</strong><br>${result.care_plan.map((item) => `- ${item}`).join("<br>")}</p>
            <p><strong>Precautions:</strong><br>${result.precautions.map((item) => `- ${item}`).join("<br>")}</p>
            <p><strong>Follow Up:</strong> ${result.follow_up}</p>
            <div class="agent-source">Source: ${result.provider || result.mode}${result.model ? ` (${result.model})` : ""}</div>
        `;
    }

    async function requestHealthRecommendation() {
        if (!selectedPatientId) {
            setRecommendationStatus("Select a patient first.", false);
            return;
        }

        const patient = getPatientById(selectedPatientId);
        const button = document.getElementById("getHealthRecommendationBtn");
        button.disabled = true;
        button.textContent = "Getting recommendation...";
        setRecommendationStatus("Generating AI health recommendation...", apiConfig.apiEnabled);

        try {
            const response = await fetch("/api/health-recommendation", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(getPatientPayload(patient))
            });

            if (!response.ok) {
                throw new Error("Health recommendation request failed.");
            }

            const result = await response.json();
            renderRecommendationResult(result);
            setRecommendationStatus(`Recommendation ready for ${patient.name}.`, result.mode === "live_api");
        } catch (error) {
            setRecommendationStatus("Could not generate the health recommendation.", false);
        } finally {
            button.disabled = false;
            button.textContent = "Get AI Health Recommendation";
        }
    }

    async function askAboutSelectedPatient() {
        if (!selectedPatientId) {
            setChatStatus("Select a patient first.", false);
            return;
        }

        const patient = getPatientById(selectedPatientId);
        const questionInput = document.getElementById("chatQuestion");
        const question = questionInput.value.trim();
        if (!question) {
            setChatStatus("Enter a question for the selected patient.", false);
            return;
        }

        const button = document.getElementById("askPatientBtn");
        button.disabled = true;
        button.textContent = "Asking AI...";
        setChatStatus("Sending patient context to the assistant...", apiConfig.apiEnabled);

        try {
            const response = await fetch("/api/patient-chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    ...getPatientPayload(patient),
                    question
                })
            });

            if (!response.ok) {
                throw new Error("Patient chat request failed.");
            }

            const result = await response.json();
            renderChatAnswer(result.answer, result);
            setChatStatus(`Answer ready for ${patient.name}.`, result.mode === "live_api");
        } catch (error) {
            setChatStatus("Could not get an answer from the assistant.", false);
        } finally {
            button.disabled = false;
            button.textContent = "Ask AI About Selected Patient";
        }
    }

    function simulateVitalsUpdate() {
        patients.forEach((patient) => {
            patient.heartRate += Math.floor(Math.random() * 7) - 3;
            if (Math.random() < 0.3) {
                patient.oxygen += Math.random() < 0.5 ? -1 : 1;
            }

            patient.oxygen = Math.max(85, Math.min(100, patient.oxygen));
            patient.heartRate = Math.max(45, Math.min(130, patient.heartRate));
            patient.aiRisk = evaluateRisk(patient);
            patient.lastUpdated = new Date().toLocaleString("en-US");

            patient.history.push({
                time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                heartRate: patient.heartRate,
                oxygen: patient.oxygen
            });

            if (patient.history.length > 10) {
                patient.history.shift();
            }
        });

        displayPatientCards();
        checkVitalsForAlerts();

        const activePatientLink = document.querySelector("#patientList li a.active");
        if (activePatientLink) {
            const activePatientId = activePatientLink.dataset.patientId;
            displayPatientDetailsById(activePatientId);
            displayPatientHistoryById(activePatientId);
        }

        autoTriageChangedPatients();
    }

    async function handlePatientIntake(event) {
        event.preventDefault();
        const formStatus = document.getElementById("formStatus");

        const payload = {
            name: document.getElementById("pName").value.trim(),
            age: Number(document.getElementById("pAge").value),
            room: document.getElementById("pRoom").value.trim(),
            approvedPhone: document.getElementById("pPhone").value.trim(),
            heartRate: Number(document.getElementById("pHeartRate").value),
            bloodPressure: document.getElementById("pBloodPressure").value.trim(),
            oxygen: Number(document.getElementById("pOxygen").value),
            treatmentPlan: "New admission. Continue physician-directed ICU protocol.",
            aiRisk: "Low",
            history: [],
            lastUpdated: new Date().toLocaleString("en-US")
        };

        try {
            const response = await fetch("/api/patients", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Could not add patient.");
            }

            await fetchPatients();
            displayPatientCards();
            displayPatientList();
            checkVitalsForAlerts();
            event.target.reset();
            formStatus.textContent = `Patient added. Share code ${result.accessCode} and open /mobile.html on any connected device.`;
        } catch (error) {
            formStatus.textContent = error.message;
        }
    }

    document.getElementById("patientForm").addEventListener("submit", handlePatientIntake);
    document.getElementById("viewPatientBtn").addEventListener("click", updatePhoneViewer);
    document.getElementById("runTriageBtn").addEventListener("click", runAITriageForAllPatients);
    document.getElementById("askPatientBtn").addEventListener("click", askAboutSelectedPatient);
    document.getElementById("getHealthRecommendationBtn").addEventListener("click", requestHealthRecommendation);

    async function initialize() {
        updateDateTime();
        await loadApiConfig();
        await fetchPatients();
        displayPatientCards();
        displayPatientList();
        checkVitalsForAlerts();
        await runAITriageForAllPatients();
    }

    initialize();
    setInterval(updateDateTime, 1000);
    setInterval(simulateVitalsUpdate, 2500);
});
