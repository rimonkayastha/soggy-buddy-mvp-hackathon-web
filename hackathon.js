const authToken = "DScZAFUIGtjpCs0SfMeE3lhhYOgTBhzx";
const mqttUrl = "wss://sgp1.blynk.cloud:443/mqtt";
const fireThresholds = {
  temperature: { warning: 35, extreme: 45, unit: "°C", direction: "above" },
  humidity: { warning: 25, extreme: 15, unit: "%", direction: "below" },
  soilMoisture: { warning: 25, extreme: 10, unit: "%", direction: "below" }
};
const datastreamAliases = {
  temperature: ["temperature", "v0"],
  humidity: ["humidity", "v1"],
  soilMoisture: ["soil moisture", "soil_moisture", "soilmoisture", "v3"]
};

const sensorReadings = {
  temperature: null,
  humidity: null,
  soilMoisture: null
};

let lastCriticalSignature = "";

function setSensorValue(id, value, unit) {
  document.querySelector(`#${id}`).innerHTML = `${value ?? "--"}<span>${unit}</span>`;
}

function normalizeDatastreamName(name) {
  return name.toLowerCase().replace(/[-_]/g, " ").trim();
}

function evaluateFireRisk() {
  const definitions = [
    { name: "Temperature", key: "temperature", value: sensorReadings.temperature, threshold: fireThresholds.temperature },
    { name: "Humidity", key: "humidity", value: sensorReadings.humidity, threshold: fireThresholds.humidity },
    { name: "Soil moisture", key: "soilMoisture", value: sensorReadings.soilMoisture, threshold: fireThresholds.soilMoisture }
  ];
  const checks = definitions.filter((check) => Number.isFinite(check.value));
  const triggered = checks.filter((check) => check.threshold.direction === "above"
    ? check.value >= check.threshold.warning
    : check.value <= check.threshold.warning);
  const extreme = checks.filter((check) => check.threshold.direction === "above"
    ? check.value >= check.threshold.extreme
    : check.value <= check.threshold.extreme);
  const isCritical = triggered.length >= 2 || extreme.length > 0;
  const alertBanner = document.querySelector(".alert-banner");
  const alertSymbol = document.querySelector("#alert-symbol");
  const warningTitle = document.querySelector("#warning-title");
  const warningMessage = document.querySelector("#warning-message");

  if (triggered.length === 0) {
    warningTitle.textContent = "No fire risk detected at SUTD";
    warningMessage.textContent = "Temperature, humidity and soil moisture are within the configured safety range.";
    alertSymbol.textContent = "✓";
    alertBanner.classList.add("acknowledged");
    lastCriticalSignature = "";
    return;
  }

  const details = triggered.map((check) => (
    `${check.name}: ${check.value}${check.threshold.unit} (${check.threshold.direction} ${check.threshold.warning}${check.threshold.unit})`
  ));
  const signature = `${isCritical ? "critical" : "warning"}:${details.join("|")}`;

  warningTitle.textContent = isCritical
    ? "Critical fire risk detected at SUTD"
    : "Fire risk warning detected at SUTD";
  warningMessage.textContent = details.join(" | ");
  alertSymbol.textContent = isCritical ? "!" : "△";
  alertBanner.classList.toggle("critical", isCritical);
  alertBanner.classList.toggle("acknowledged", !isCritical);

  if (isCritical && signature !== lastCriticalSignature) {
    const dialog = document.querySelector("#critical-dialog");
    document.querySelector("#critical-warning-details").textContent =
      `${extreme.length > 0 ? "An extreme reading was detected. " : "Multiple warning thresholds were crossed. "}${details.join(" | ")}. Immediate field inspection is recommended.`;
    if (!dialog.open) {
      dialog.showModal();
    }
    lastCriticalSignature = signature;
  }
}

function updateDatastreamValue(datastream, value) {
  const normalizedName = normalizeDatastreamName(datastream);
  const numericValue = Number.parseFloat(value);

  if (datastreamAliases.temperature.includes(normalizedName)) {
    sensorReadings.temperature = numericValue;
    setSensorValue("temperature-value", value, "°C");
  } else if (datastreamAliases.humidity.includes(normalizedName)) {
    sensorReadings.humidity = numericValue;
    setSensorValue("humidity-value", value, "%");
  } else if (datastreamAliases.soilMoisture.includes(normalizedName)) {
    sensorReadings.soilMoisture = numericValue;
    setSensorValue("soil-moisture-value", value, "%");
  }

  evaluateFireRisk();
}

let mqttClient;
let mqttReady;

function connectToSensorStream() {
  mqttReady = new Promise((resolve, reject) => {
    mqttClient = mqtt.connect(mqttUrl, {
      clientId: `soggy-buddy-${Date.now()}`,
      username: "device",
      password: authToken,
      clean: true,
      keepalive: 45,
      reconnectPeriod: 3000
    });

    mqttClient.on("connect", () => {
      mqttClient.subscribe("downlink/ds/#", (error) => {
        if (error) {
          console.error("Sensor stream subscription error:", error);
          return;
        }

        mqttClient.publish("get/ds", "Temperature,Humidity,Soil Moisture");
        document.querySelector(".sync-status").innerHTML = "<i></i>Live connection";
        resolve();
      });
    });

    mqttClient.on("message", (topic, payload) => {
      const datastream = topic.replace("downlink/ds/", "");
      updateDatastreamValue(datastream, payload.toString());
    });

    mqttClient.on("reconnect", () => {
      document.querySelector(".sync-status").innerHTML = "<i></i>Reconnecting";
    });

    mqttClient.on("error", (error) => {
      console.error("Sensor stream error:", error);
      document.querySelector(".sync-status").textContent = "Live connection unavailable";
      reject(error);
    });
  });

  return mqttReady;
}

function requestLatestSensorData() {
  return mqttReady.then(() => {
    mqttClient.publish("get/ds", "Temperature,Humidity,Soil Moisture");
  });
}

connectToSensorStream().catch(error => console.error("Error connecting to sensor stream:", error));

const sutdMap = L.map("sutd-map").setView([1.3404, 103.9634], 16);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(sutdMap);

L.marker([1.3404, 103.9634])
  .addTo(sutdMap)
  .bindPopup("SUTD sensor location")
  .openPopup();

document.querySelector("#acknowledge-button").addEventListener(
  "click",
  (event) => {
    const button = event.currentTarget;
    button.textContent = "Warning acknowledged";
    document.querySelector(".alert-banner").classList.add("acknowledged");
  }
);

document.querySelector("#refresh-button").addEventListener(
  "click",
  async (event) => {
    event.currentTarget.textContent = "Refreshing…";
    sutdMap.invalidateSize();

    try {
      await requestLatestSensorData();
      event.currentTarget.textContent = "Data refreshed";
    } catch (error) {
      console.error("Error refreshing data:", error);
      event.currentTarget.textContent = "Refresh failed";
    } finally {
      window.setTimeout(() => {
        event.currentTarget.textContent = "Refresh data";
      }, 1500);
    }
  }
);

document.querySelector("#view-toggle").addEventListener("click", () => {
  document.querySelector("#zone-list").classList.toggle("compact");
});