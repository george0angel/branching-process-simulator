/* global Plotly */

const form = document.querySelector("#controls");
const button = document.querySelector("#simulate-button");
const status = document.querySelector("#status");

const summary = {
  finalPopulation: document.querySelector("#final-population"),
  particlesCreated: document.querySelector("#particles-created"),
  maximumGeneration: document.querySelector("#maximum-generation"),
  meanFinalPosition: document.querySelector("#mean-final-position"),
  minPosition: document.querySelector("#min-position"),
  maxPosition: document.querySelector("#max-position"),
  minFinalPosition: document.querySelector("#min-final-position"),
  maxFinalPosition: document.querySelector("#max-final-position"),
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

function getFrameData(particle, graphMode, currentTime) {
  const x = [];
  const y = [];
  const z = [];

  for (const [time, position] of particle.path) {
    const EPSILON = 1e-12;
    if (time > currentTime + EPSILON) {
      break;
    }

    switch (graphMode) {
      case "xt":
        x.push(time);
        y.push(position[0]);
        break;
      case "xy":
        x.push(position[0]);
        y.push(position[1]);
        break;
      case "xyt":
        x.push(position[0]);
        y.push(position[1]);
        z.push(time);
        break;
      case "xyz":
        x.push(position[0]);
        y.push(position[1]);
        z.push(position[2]);
        break;
    }
  }

  return graphMode === "xt" || graphMode === "xy" ? { x, y } : { x, y, z };
}

function drawAnimated(result, graphMode, animationDuration) {
  const frameCount = Math.min(
    (20 * animationDuration) / 1000 + 1,
    result.summary.steps + 1,
  );
  const startTime = result.populationHistory.at(0)[0];
  const endTime = result.populationHistory.at(-1)[0];
  const times = Array.from(
    { length: frameCount },
    (_, index) =>
      startTime + ((endTime - startTime) * index) / (frameCount - 1),
  );
  const traceIds = result.particles.map((_, index) => index);
  const frames = times.map((time, index) => ({
    name: `frame-${index}`,
    traces: traceIds,
    data: result.particles.map((particle) =>
      getFrameData(particle, graphMode, time),
    ),
  }));

  const is2D = graphMode === "xt" || graphMode === "xy";
  const traces = frames[0].data.map((data) => ({
    type: is2D ? "scattergl" : "scatter3d",
    mode: "lines",
    ...data,
    line: {
      width: is2D ? 1 : 2,
    },
    showlegend: false,
  }));

  const minPosition = result.summary.minPosition;
  const maxPosition = result.summary.maxPosition;
  const range = minPosition.map((min, index) => [min, maxPosition[index]]);
  const frameDuration = animationDuration / Math.max(frames.length - 1, 1);

  const updatemenus = [
    {
      type: "buttons",
      direction: "left",
      showactive: false,
      x: 0,
      y: -0.14,
      font: {
        size: 16,
      },
      buttons: [
        {
          label: "&#9654;",
          method: "skip",
        },
      ],
    },
  ];

  const sliders = [
    {
      active: frames.length - 1,
      y: -0.04,
      currentvalue: {
        prefix: "Time: ",
      },
      steps: frames.map((frame, index) => ({
        label: times[index].toFixed(2),
        method: "animate",
        args: [
          [frame.name],
          {
            mode: "immediate",
            frame: { duration: 0, redraw: true },
            transition: { duration: 0 },
          },
        ],
      })),
    },
  ];

  let layout;

  if (is2D) {
    layout = {
      xaxis: {
        title: { text: graphMode === "xt" ? "Time" : "X" },
        range: graphMode === "xt" ? [startTime, endTime] : range[0],
      },

      yaxis: {
        title: { text: graphMode === "xt" ? "X" : "Y" },
        range: graphMode === "xt" ? range[0] : range[1],
      },

      margin: {
        l: 40,
        r: 20,
        t: 20,
        b: 30,
      },
      updatemenus,
      sliders,
    };
  } else {
    layout = {
      scene: {
        xaxis: {
          title: { text: "X" },
          range: range[0],
        },

        yaxis: {
          title: { text: "Y" },
          range: range[1],
        },

        zaxis: {
          title: { text: graphMode === "xyt" ? "Time" : "Z" },
          range: graphMode === "xyt" ? [startTime, endTime] : range[2],
        },

        aspectmode: "data",
      },

      margin: {
        l: 0,
        r: 0,
        t: 0,
        b: 0,
      },
      updatemenus,
      sliders,
    };
  }

  Plotly.purge("trajectory-plot");
  Plotly.newPlot("trajectory-plot", traces, layout, {
    responsive: true,
  });
  Plotly.addFrames("trajectory-plot", frames);
  Plotly.animate("trajectory-plot", [frames.at(-1).name], {
    mode: "immediate",
    frame: { duration: 0, redraw: true },
    transition: { duration: 0 },
  });

  const plot = document.getElementById("trajectory-plot");
  let isPlaying = false;
  let currentFrame = frames.length - 1;

  plot.on("plotly_animatingframe", (event) => {
    const index = Number(event.name.slice("frame-".length));
    currentFrame = index;

    if (plot.layout.sliders[0].active !== index) {
      Plotly.relayout(plot, {
        "sliders[0].active": index,
      });
    }
  });

  plot.on("plotly_sliderchange", (event) => {
    currentFrame = event.slider.active;
    if (isPlaying) {
      isPlaying = false;

      Plotly.relayout(plot, {
        "updatemenus[0].buttons[0].label": "&#9654;",
      });
    }
  });

  plot.on("plotly_buttonclicked", async () => {
    if (isPlaying) {
      // Pause
      isPlaying = false;

      Plotly.animate(plot, [null], {
        mode: "immediate",
        frame: {
          duration: 0,
          redraw: false,
        },
        transition: {
          duration: 0,
        },
      });

      Plotly.relayout(plot, {
        "updatemenus[0].buttons[0].label": "&#9654;",
      });

      return;
    }

    // Play
    const atEnd = currentFrame === frames.length - 1;
    isPlaying = true;

    Plotly.relayout(plot, {
      "updatemenus[0].buttons[0].label": "&#9208;",
    });

    if (atEnd) {
      // At the end then restart from the beginning.
      try {
        await Plotly.animate(
          plot,
          frames.map((frame) => frame.name),
          {
            mode: "immediate",
            fromcurrent: false,
            frame: {
              duration: frameDuration,
              redraw: true,
            },
            transition: {
              duration: 0,
            },
          },
        );
      } catch {}
    } else {
      // Paused partly through then continue from current frame.
      try {
        await Plotly.animate(plot, null, {
          mode: "immediate",
          fromcurrent: true,
          frame: {
            duration: frameDuration,
            redraw: true,
          },
          transition: {
            duration: 0,
          },
        });
      } catch {}
    }

    isPlaying = false;

    Plotly.relayout(plot, {
      "updatemenus[0].buttons[0].label": "&#9654;",
    });
  });
}

function draw(result) {
  const graphMode = document.querySelector("#graph-mode").value;
  const animationDuration =
    Number(document.querySelector("#animation").value) * 1000;
  drawAnimated(result, graphMode, animationDuration);
}

function showSummary(result) {
  summary.finalPopulation.textContent = result.summary.finalPopulation;
  summary.particlesCreated.textContent = result.summary.totalParticlesCreated;
  summary.maximumGeneration.textContent = result.summary.maximumGeneration;
  summary.meanFinalPosition.textContent = result.summary.meanFinalPosition
    .map((value) => value.toFixed(3))
    .join(", ");
  summary.minPosition.textContent = result.summary.minPosition
    .map((value) => value.toFixed(3))
    .join(", ");
  summary.maxPosition.textContent = result.summary.maxPosition
    .map((value) => value.toFixed(3))
    .join(", ");
  summary.minFinalPosition.textContent = result.summary.minFinalPosition
    .map((value) => value.toFixed(3))
    .join(", ");
  summary.maxFinalPosition.textContent = result.summary.maxFinalPosition
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
    document.querySelector("#seed").value = latestResult.parameters.seed;
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
