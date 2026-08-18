/* global Plotly */

const form = document.querySelector("#controls");
const button = document.querySelector("#simulate-button");
const status = document.querySelector("#status");

const summary = {
  finalPopulation: document.querySelector("#final-population"),
  particlesCreated: document.querySelector("#particles-created"),
  maximumGeneration: document.querySelector("#maximum-generation"),
  meanFinalPosition: document.querySelector("#mean-final-position"),
  note: document.querySelector("#note"),
};

const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});

let latestResult = null;
let requestId = 0;

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

function getSpatialDimensions(graphMode) {
  switch (graphMode) {
    case "xt":
      return 1;
    case "xy":
    case "xyt":
      return 2;
    case "xyz":
      return 3;
    default:
      throw new Error(`Invalid graph mode.`);
  }
}

function readParameters() {
  const processType = document.getElementById(`process-type`).value;
  const seed = Number(document.querySelector("#seed").value);
  const seedOn = document.querySelector("#seed-on").checked;

  const graphMode = document.querySelector("#graph-mode").value;
  const dimensions = getSpatialDimensions(graphMode);

  return {
    processType,
    duration: Number(document.querySelector("#duration").value),
    dt: processType === `rw` ? 1 : Number(document.querySelector("#dt").value),
    diffusion: Array(dimensions).fill(
      Number(document.querySelector("#diffusion").value),
    ),
    drift: Array(dimensions).fill(
      Number(document.querySelector("#drift").value),
    ),
    branchingRate:
      Number(document.querySelector("#branching-on").checked) *
      Number(document.querySelector("#branching-rate").value),
    initialParticles: Number(
      document.querySelector("#initial-particles").value,
    ),
    maxParticles:
      Number(document.querySelector("#branching-on").checked) *
      Number(document.querySelector("#max-particles-on").checked) *
      Number(document.querySelector("#max-particles").value),
    seed: seedOn === true ? seed : randomSeed(),
    startingPosition: Array(dimensions).fill(0),
  };
}

function runWorker(parameters) {
  return new Promise((resolve, reject) => {
    requestId += 1;
    const currentRequest = requestId;

    function receiveMessage(event) {
      if (event.data.requestId !== currentRequest) {
        return;
      }

      worker.removeEventListener("message", receiveMessage);

      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.result);
      }
    }

    worker.addEventListener("message", receiveMessage);
    worker.postMessage({ requestId: currentRequest, parameters });
  });
}

function draw2D(result, graphMode) {
  const traces = [];

  for (const particle of result.particles) {
    if (particle.path.length < 2) {
      continue;
    }

    var x = [];
    var y = [];

    for (const [time, position] of particle.path) {
      if (graphMode === "xt") {
        x.push(time);
        y.push(position[0]);
      } else if (graphMode === "xy") {
        x.push(position[0]);
        y.push(position[1]);
      }
    }

    traces.push({
      type: "scattergl",
      mode: "lines",
      x: x,
      y: y,
      line: {
        width: 1,
      },
      showlegend: false,
    });
  }

  Plotly.react(
    "trajectory-plot",
    traces,
    {
      xaxis: {
        title: { text: graphMode === "xt" ? "Time" : "X" },
      },

      yaxis: {
        title: { text: graphMode === "xt" ? "X" : "Y" },
      },

      margin: {
        l: 40,
        r: 20,
        t: 20,
        b: 30,
      },
    },

    {
      responsive: true,
    },
  );
}

function draw3D(result, graphMode) {
  const traces = [];

  for (const particle of result.particles) {
    if (particle.path.length < 2) {
      continue;
    }

    const x = [];
    const y = [];
    const z = [];

    for (const [time, position] of particle.path) {
      if (graphMode === "xyt") {
        x.push(position[0]);
        y.push(position[1]);
        z.push(time);
      } else {
        x.push(position[0]);
        y.push(position[1]);
        z.push(position[2]);
      }
    }

    traces.push({
      type: "scatter3d",
      mode: "lines",

      x,
      y,
      z,

      line: {
        width: 2,
      },

      showlegend: false,
    });
  }

  Plotly.react(
    "trajectory-plot",
    traces,
    {
      scene: {
        xaxis: {
          title: { text: "X" },
        },

        yaxis: {
          title: { text: "Y" },
        },

        zaxis: {
          title: { text: graphMode === "xyt" ? "Time" : "Z" },
        },

        aspectmode: "data",
      },

      margin: {
        l: 0,
        r: 0,
        t: 0,
        b: 0,
      },
    },
    {
      responsive: true,
    },
  );
}

function draw(result) {
  const graphMode = document.querySelector("#graph-mode").value;

  if (graphMode === "xt" || graphMode === "xy") {
    draw2D(result, graphMode);
  } else {
    draw3D(result, graphMode);
  }
}

function showSummary(result) {
  summary.finalPopulation.textContent = result.summary.finalPopulation;
  summary.particlesCreated.textContent = result.summary.totalParticlesCreated;
  summary.maximumGeneration.textContent = result.summary.maximumGeneration;
  summary.meanFinalPosition.textContent = result.summary.meanFinalPosition
    .map((value) => value.toFixed(3))
    .join(", ");

  summary.note.textContent = result.summary.populationCapReached
    ? "The population cap was reached."
    : "The population cap was not reached.";
}

async function simulate(event) {
  event.preventDefault();
  button.disabled = true;

  const maxParticlesInput = document.querySelector("#max-particles");

  const initialParticles = Number(
    document.querySelector("#initial-particles").value,
  );
  const maxParticles = Number(maxParticlesInput.value);
  const maxParticlesOn =
    Number(document.querySelector("#max-particles-on").checked) *
    Number(document.querySelector("#branching-on").checked);

  maxParticlesInput.setCustomValidity("");

  if (maxParticles < initialParticles * maxParticlesOn) {
    maxParticlesInput.setCustomValidity(
      "Population cap cannot be less than initial particles.",
    );
    maxParticlesInput.reportValidity();
    button.disabled = false;
    return;
  }

  status.textContent = "Running...";
  summary.note.textContent = "";

  try {
    latestResult = await runWorker(readParameters());
    draw(latestResult);
    showSummary(latestResult);
    status.textContent = "Complete";
  } catch (error) {
    status.textContent = "Error";
    summary.note.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

form.addEventListener("submit", simulate);

document.querySelector("#max-particles").addEventListener("input", (event) => {
  event.target.setCustomValidity("");
});

document.querySelector("#initial-particles").addEventListener("input", () => {
  document.querySelector("#max-particles").setCustomValidity("");
});

document.querySelector("#max-particles-on").addEventListener("change", () => {
  document.querySelector("#max-particles").setCustomValidity("");
});

// Jump parameter.
document.addEventListener("DOMContentLoaded", () => {
  const inputs = document.querySelectorAll('input[type="number"][data-jump]');

  inputs.forEach((input) => {
    const jump = parseFloat(input.dataset.jump);
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);

    let previousValue = parseFloat(input.value);
    let isManualChange = false;

    function decimalPlaces(value) {
      const string = String(value);

      if (string.includes("e-")) {
        return parseInt(string.split("e-")[1], 10);
      }

      return (string.split(".")[1] || "").length;
    }

    function jumpValue(value, direction) {
      const precision = Math.max(
        decimalPlaces(value),
        decimalPlaces(jump),
        Number.isNaN(min) ? 0 : decimalPlaces(min),
        Number.isNaN(max) ? 0 : decimalPlaces(max),
      );

      const scale = 10 ** precision;

      const scaledValue = Math.round(value * scale);
      const scaledJump = Math.round(jump * scale);

      let result;

      if (direction > 0) {
        result =
          scaledValue % scaledJump === 0
            ? scaledValue + scaledJump
            : Math.ceil(scaledValue / scaledJump) * scaledJump;
      } else {
        result =
          scaledValue % scaledJump === 0
            ? scaledValue - scaledJump
            : Math.floor(scaledValue / scaledJump) * scaledJump;
      }

      if (!Number.isNaN(min)) {
        result = Math.max(result, Math.round(min * scale));
      }

      if (!Number.isNaN(max)) {
        result = Math.min(result, Math.round(max * scale));
      }

      return result / scale;
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();

        const currentValue = parseFloat(input.value);

        input.value = jumpValue(currentValue, event.key === "ArrowUp" ? 1 : -1);

        previousValue = parseFloat(input.value);
        isManualChange = false;
      } else {
        isManualChange = true;
      }
    });

    input.addEventListener("input", () => {
      const currentValue = parseFloat(input.value);
      const step = parseFloat(input.step);

      const difference = Math.abs(currentValue - previousValue);

      const isStepChange = Math.abs(difference - step) < step * 0.001;

      if (!isManualChange && isStepChange) {
        input.value = jumpValue(
          previousValue,
          currentValue > previousValue ? 1 : -1,
        );
      }

      previousValue = parseFloat(input.value);
      isManualChange = false;
    });
  });
});

// Stop scroll from changing inputs.
document.querySelectorAll('input[type="number"]').forEach((input) => {
  input.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      window.scrollBy({
        top: event.deltaY,
        left: event.deltaX,
      });
    },
    { passive: false },
  );
});

// Process selection handler and input visibility.
const hideableFields = document.querySelectorAll(`div[data-process]`);
const inputFields = document.querySelectorAll(`input`);

function updateVisibility() {
  const processType = document.getElementById(`process-type`).value;
  for (const field of hideableFields) {
    const allowedParameters = field.dataset.process.split(` `);

    if (allowedParameters.includes(processType)) {
      field.style.display = "block";
    } else {
      field.style.display = "none";
    }
  }
}

function updateEnabled() {
  for (const field of inputFields) {
    switch (field.id) {
      case `branching-rate`:
        document.getElementById(`branching-on`).checked
          ? (field.disabled = false)
          : (field.disabled = true);
        if (document.getElementById(`branching-on`).checked) {
          field.disabled = false;
          document.getElementById(`max-particles-on`).disabled = false;
        } else {
          field.disabled = true;
          document.getElementById(`max-particles-on`).disabled = true;
        }
        break;
      case `max-particles`:
        document.getElementById(`branching-on`).checked &&
        document.getElementById(`max-particles-on`).checked
          ? (field.disabled = false)
          : (field.disabled = true);
        break;
      case `seed`:
        document.getElementById(`seed-on`).checked
          ? (field.disabled = false)
          : (field.disabled = true);
        break;
    }
  }
}

document
  .getElementById(`process-type`)
  .addEventListener(`change`, updateVisibility);

document.querySelectorAll(`input[type="checkbox"]`).forEach((checkbox) => {
  checkbox.addEventListener(`change`, updateEnabled);
});

updateVisibility();
updateEnabled();
//document.getElementById(`process-type`).dispatchEvent(new Event(`change`));
