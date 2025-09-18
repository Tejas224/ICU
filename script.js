// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // Sample data for patients, now including history and treatment plans
    const patients = [
        { name: "Tejas Patil", age: 21, room: "101", heartRate: 78, bloodPressure: "120/80", oxygen: 98, history: [], treatmentPlan: "Standard observation. Check vitals every hour." },
        { name: "Sakshi Bandbe", age: 72, room: "102", heartRate: 85, bloodPressure: "130/85", oxygen: 95, history: [], treatmentPlan: "Administer oxygen if SpO2 drops below 94%. Monitor blood pressure." },
        { name: "Darshan Kharat ", age: 58, room: "103", heartRate: 90, bloodPressure: "140/90", oxygen: 95, history: [], treatmentPlan: "Awaiting cardiology consult. Maintain bed rest." },
        { name: "Shiva Patil", age: 25, room: "104", heartRate: 90, bloodPressure: "140/90", oxygen: 92, history: [], treatmentPlan: "Monitor for any signs of respiratory distress." },
        { name: "Shraddha Patil", age: 20, room: "105", heartRate: 90, bloodPressure: "145/90", oxygen: 92, history: [], treatmentPlan: "Follow up on lab results. Encourage fluid intake." },
        { name: "Shivam Patil", age: 75, room: "106", heartRate: 90, bloodPressure: "140/90", oxygen: 92, history: [], treatmentPlan: "Physical therapy scheduled for 2 PM. Assist with mobility." },
    ];

    // Initial alerts data (can be modified dynamically)
    let alerts = [];

    /**
     * Returns a CSS class name based on the vital's value and type.
     * @param {string} vitalName - The name of the vital ('heartRate' or 'oxygen').
     * @param {number} value - The current value of the vital.
     * @returns {string} The CSS class ('vital-normal', 'vital-warning', 'vital-danger').
     */
    function getVitalStatusClass(vitalName, value) {
        if (vitalName === 'heartRate') {
            if (value > 100) return 'vital-danger';
            if (value > 90) return 'vital-warning';
            return 'vital-normal';
        }
        if (vitalName === 'oxygen') {
            if (value < 92) return 'vital-danger';
            if (value < 95) return 'vital-warning';
            return 'vital-normal';
        }
        return ''; // Default class
    }

    /**
     * Renders the patient cards on the dashboard with up-to-date vitals.
     */
    function displayPatientCards() {
        const patientCardsContainer = document.getElementById('patientCards');
        if (!patientCardsContainer) return;

        patientCardsContainer.innerHTML = ''; // Clear old cards before redrawing
        patients.forEach(patient => {
            const card = document.createElement('div');
            card.className = 'patient-card';

            const hrClass = getVitalStatusClass('heartRate', patient.heartRate);
            const oxygenClass = getVitalStatusClass('oxygen', patient.oxygen);

            card.innerHTML = `
                <h3>${patient.name}</h3>
                <p>Age: ${patient.age}</p>
                <p>Room: ${patient.room}</p>
                <p>Heart Rate: <span class="${hrClass}">${patient.heartRate}</span> bpm</p>
                <p>Blood Pressure: ${patient.bloodPressure}</p>
                <p>Oxygen: <span class="${oxygenClass}">${patient.oxygen}</span>%</p>
            `;
            patientCardsContainer.appendChild(card);
        });
    }

    /**
     * Renders the list of active alerts.
     */
    function displayAlerts() {
        const alertList = document.getElementById('alertList');
        if (!alertList) return;

        alertList.innerHTML = ''; // Clear old alerts
        if (alerts.length === 0) {
            alertList.innerHTML = '<p>No active alerts.</p>';
            return;
        }
        alerts.forEach(alert => {
            const listItem = document.createElement('li');
            listItem.textContent = alert.message;
            listItem.className = alert.priority.toLowerCase();
            alertList.appendChild(listItem);
        });
    }

    /**
     * Updates the date and time in the header.
     */
    function updateDateTime() {
        const dateTimeElement = document.getElementById('dateTime');
        if (!dateTimeElement) return;
        const now = new Date();
        dateTimeElement.textContent = now.toLocaleString('en-IN', {
            dateStyle: 'full',
            timeStyle: 'medium'
        });
    }

    /**
     * Displays the details of a selected patient in the Nurse Overview.
     * @param {string} patientName - The name of the patient to display.
     */
    function displayPatientDetails(patientName) {
        const patient = patients.find(p => p.name.trim() === patientName.trim());
        const patientDetailsContainer = document.getElementById('patientDetails');
        if (!patientDetailsContainer) return;

        if (patient) {
            patientDetailsContainer.innerHTML = `
                <h3>${patient.name}</h3>
                <p>Age: ${patient.age}</p>
                <p>Room: ${patient.room}</p>
                <p>Heart Rate: <span class="${getVitalStatusClass('heartRate', patient.heartRate)}">${patient.heartRate}</span> bpm</p>
                <p>Blood Pressure: ${patient.bloodPressure}</p>
                <p>Oxygen: <span class="${getVitalStatusClass('oxygen', patient.oxygen)}">${patient.oxygen}</span>%</p>
            `;
        } else {
            patientDetailsContainer.innerHTML = `<p>Patient details not found.</p>`;
        }
    }

    /**
     * Displays the vitals history of a selected patient.
     * @param {string} patientName - The name of the patient.
     */
    function displayPatientHistory(patientName) {
        const patient = patients.find(p => p.name.trim() === patientName.trim());
        const historyContainer = document.querySelector('.patient-history');
        if (!historyContainer) return;

        if (patient && patient.history.length > 0) {
            let historyHtml = `<h3>Patient History</h3><ul>`;
            // Show the most recent history first by reversing a copy of the array
            [...patient.history].reverse().forEach(entry => {
                historyHtml += `<li>${entry.time} - HR: ${entry.heartRate}, SpO2: ${entry.oxygen}%</li>`;
            });
            historyHtml += '</ul>';
            historyContainer.innerHTML = historyHtml;
        } else {
            historyContainer.innerHTML = `<h3>Patient History</h3><p>No history available for ${patientName}.</p>`;
        }
    }

    /**
     * Displays the treatment plan for a selected patient.
     * @param {string} patientName - The name of the patient.
     */
    function displayTreatmentPlan(patientName) {
        const patient = patients.find(p => p.name.trim() === patientName.trim());
        const planContainer = document.querySelector('.treatment-plans');
        if (!planContainer) return;

        if (patient) {
            planContainer.innerHTML = `
                <h3>Treatment Plan</h3>
                <p>${patient.treatmentPlan}</p>
            `;
        } else {
            planContainer.innerHTML = `<h3>Treatment Plan</h3><p>Select a patient to view their plan.</p>`;
        }
    }


    /**
     * Attaches click event listeners to the patient links in the Nurse Overview.
     */
    function attachPatientClickListeners() {
        const patientLinks = document.querySelectorAll('.available-patients li a');
        patientLinks.forEach(link => {
            link.addEventListener('click', function(event) {
                event.preventDefault();

                // Manage active state for visual feedback
                patientLinks.forEach(l => l.classList.remove('active'));
                this.classList.add('active');

                const patientName = this.textContent;
                // Update all details sections
                displayPatientDetails(patientName);
                displayPatientHistory(patientName);
                displayTreatmentPlan(patientName);
            });
        });
    }

    /**
     * Checks patient vitals against thresholds and generates/removes alerts.
     */
    function checkVitalsForAlerts() {
        const highHeartRateThreshold = 100;
        const lowOxygenThreshold = 92;

        patients.forEach(patient => {
            // Check for high heart rate
            const hrAlertMessage = `${patient.name}: Heart Rate Elevated (${patient.heartRate} bpm)`;
            const hrAlertExists = alerts.some(a => a.message === hrAlertMessage);
            if (patient.heartRate > highHeartRateThreshold && !hrAlertExists) {
                alerts.push({ message: hrAlertMessage, priority: "High" });
            } else if (patient.heartRate <= highHeartRateThreshold) {
                alerts = alerts.filter(a => !a.message.startsWith(`${patient.name}: Heart Rate`));
            }

            // Check for low oxygen
            const oxygenAlertMessage = `${patient.name}: Oxygen Level Low (${patient.oxygen}%)`;
            const oxygenAlertExists = alerts.some(a => a.message === oxygenAlertMessage);
            if (patient.oxygen < lowOxygenThreshold && !oxygenAlertExists) {
                alerts.push({ message: oxygenAlertMessage, priority: "Medium" });
            } else if (patient.oxygen >= lowOxygenThreshold) {
                alerts = alerts.filter(a => !a.message.startsWith(`${patient.name}: Oxygen Level`));
            }
        });

        displayAlerts();
    }

    /**
     * Simulates the fluctuation of patient vitals and logs history.
     */
    function simulateVitalsUpdate() {
        patients.forEach(patient => {
            // Fluctuate heart rate and oxygen
            patient.heartRate += Math.floor(Math.random() * 7) - 3;
            if (Math.random() < 0.3) {
                patient.oxygen += Math.random() < 0.5 ? -1 : 1;
            }

            // Clamp values to a realistic range
            if (patient.oxygen > 100) patient.oxygen = 100;
            if (patient.oxygen < 85) patient.oxygen = 85;
            if (patient.heartRate < 55) patient.heartRate = 55;
            if (patient.heartRate > 110) patient.heartRate = 110;

            // Add a new entry to the patient's history
            const now = new Date();
            const timeString = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            patient.history.push({
                time: timeString,
                heartRate: patient.heartRate,
                oxygen: patient.oxygen
            });

            // Keep the history log to the last 10 entries
            if (patient.history.length > 10) {
                patient.history.shift();
            }
        });

        displayPatientCards();
        checkVitalsForAlerts();
        
        // Refresh details and history if a patient is selected
        const activePatientLink = document.querySelector('.available-patients li a.active');
        if (activePatientLink) {
            const patientName = activePatientLink.textContent;
            displayPatientDetails(patientName);
            displayPatientHistory(patientName);
        }
    }

    // --- INITIALIZATION ---
    updateDateTime();
    displayPatientCards();
    displayAlerts();
    attachPatientClickListeners();

    // Set intervals to run update functions periodically
    setInterval(updateDateTime, 1000);
    setInterval(simulateVitalsUpdate, 2500);
});

