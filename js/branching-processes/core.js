function lowbias32(x) {
  x >>>= 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function splitSeed(seed, tag) {
  return lowbias32((seed ^ Math.imul((tag + 1) >>> 0, 0x9e3779b9)) >>> 0);
}

function createIntegerRandom(seed) {
  let state = seed >>> 0;

  return function nextInteger() {
    state += 0x6d2b79f5;

    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return value ^ (value >>> 14);
  };
}

function createBinaryRandom(seed) {
  const integerRandom = createIntegerRandom(seed);

  return function nextBinary() {
    return integerRandom() & 1;
  };
}

function createUniformRandom(seed) {
  const integerRandom = createIntegerRandom(seed);

  return function nextUniform() {
    return (integerRandom() >>> 0) / 4294967296;
  };
}

// Random Integer in range [0, range - 1]
function createBoundedRandom(seed) {
  const uniformRandom = createUniformRandom(seed);

  return function nextBounded(range) {
    return Math.floor(uniformRandom() * range);
  };
}

function createNormalRandom(seed) {
  const uniformRandom = createUniformRandom(seed);

  let spare = null;

  return function nextNormal() {
    if (spare !== null) {
      const result = spare;
      spare = null;
      return result;
    }

    let first = 0;

    while (first === 0) {
      first = uniformRandom();
    }

    const second = uniformRandom();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;

    spare = magnitude * Math.sin(angle);

    return magnitude * Math.cos(angle);
  };
}

function exponentialRandom(seed, rate) {
  if (rate <= 0) return Infinity;

  const uniformRandom = createUniformRandom(seed);

  let u = uniformRandom();

  if (u === 0) {
    u = Number.EPSILON;
  }

  return -Math.log1p(-u) / rate;
}

function normalRandomVector(seed, length) {
  const normalRandom = createNormalRandom(seed);
  return Array.from({ length }, () => normalRandom());
}

function createParticle(
  parentId,
  generation,
  time,
  position,
  seed,
  branchRate,
) {
  return {
    parentId,
    generation,
    birthTime: time,
    birthPosition: [...position],
    position: [...position],
    path: [[time, [...position]]],
    seed,
    motionSeed: splitSeed(seed, 0),
    branchTime: time + exponentialRandom(seed, branchRate),
    integerValues: [Array(position.length).fill(0)],
  };
}

const bridgeLevels = 14;

function brownianBridgeValue(seed, time, dimensions) {
  const endpoint = normalRandomVector(seed, dimensions);

  let leftTime = 0;
  let rightTime = 1;
  let left = Array(dimensions).fill(0);
  let right = endpoint;
  let nodeSeed = splitSeed(seed, 0);

  for (let level = 0; level < bridgeLevels; level += 1) {
    const midpointTime = (leftTime + rightTime) / 2;
    const noise = normalRandomVector(nodeSeed, dimensions);
    const standardDeviation = Math.sqrt(rightTime - leftTime) / 2;
    const midpoint = left.map(
      (value, i) => (value + right[i]) / 2 + standardDeviation * noise[i],
    );

    if (time <= midpointTime) {
      rightTime = midpointTime;
      right = midpoint;
      nodeSeed = splitSeed(nodeSeed, 0);
    } else {
      leftTime = midpointTime;
      left = midpoint;
      nodeSeed = splitSeed(nodeSeed, 1);
    }
  }

  // Final interpolation based on the distribution of the brownian bridge.
  const alpha = (time - leftTime) / (rightTime - leftTime);
  const b = rightTime - time;
  const noise = normalRandomVector(splitSeed(nodeSeed, 2), dimensions);
  const standardDeviation = Math.sqrt(b * alpha);

  return left.map(
    (value, i) =>
      value +
      alpha * (right[i] - value) +
      standardDeviation * noise[i] -
      time * endpoint[i],
  );
}

function brownianValue(particle, age) {
  const dimensions = particle.position.length;
  const leftAge = Math.floor(age);

  while (particle.integerValues.length <= leftAge + 1) {
    const k = particle.integerValues.length - 1;
    const intervalSeed = splitSeed(particle.motionSeed, k);
    const increment = normalRandomVector(
      splitSeed(intervalSeed, 0),
      dimensions,
    );
    const previous = particle.integerValues[k];

    particle.integerValues.push(
      previous.map((value, i) => value + increment[i]),
    );
  }

  const left = particle.integerValues[leftAge];
  if (leftAge === age) return [...left];
  const right = particle.integerValues[leftAge + 1];

  const intervalSeed = splitSeed(particle.motionSeed, leftAge);
  const bridgeSeed = splitSeed(intervalSeed, 1);

  const unitAge = age - leftAge;

  const unitAgeValue = brownianBridgeValue(bridgeSeed, unitAge, dimensions);

  return left.map(
    (value, i) => value + unitAge * (right[i] - value) + unitAgeValue[i],
  );
}

function getParticlePosition(particle, time, diffusion, drift) {
  const age = time - particle.birthTime;
  const motion = brownianValue(particle, age);

  return particle.birthPosition.map(
    (start, i) => start + drift[i] * age + diffusion[i] * motion[i],
  );
}

export function simulateBranchingProcess(payload) {
  const processType = payload.processType;
  const duration = Number(payload.duration);
  const dt = Number(payload.dt);
  const diffusion = payload.diffusion.map(Number);
  const drift = payload.drift.map(Number);
  const branchingRate = Number(payload.branchingRate);
  const initialParticles = Number(payload.initialParticles);
  const maxParticles = Number(payload.maxParticles);
  const startingPosition = payload.startingPosition.map(Number);
  const seed = Number(payload.seed);

  const dimensions = startingPosition.length;

  const integerRandom = createIntegerRandom(seed);
  const binaryRandom = createBinaryRandom(seed);
  const uniformRandom = createUniformRandom(seed);
  const boundedRandom = createBoundedRandom(seed);
  const normalRandom = createNormalRandom(seed);

  const particles = [];
  let activeIds = new Set();

  for (let index = 0; index < initialParticles; index += 1) {
    particles.push(
      createParticle(
        null,
        0,
        0,
        startingPosition,
        splitSeed(seed, index),
        branchingRate,
      ),
    );
    activeIds.add(index);
  }

  const populationHistory = [[0, activeIds.size]];
  const frontierHistory = [[0, [...startingPosition], [...startingPosition]]];

  const steps = Math.floor(duration / dt);

  for (let step = 1; step <= steps; step += 1) {
    const time = step * dt;

    while (maxParticles === 0 || activeIds.size < maxParticles) {
      let parentId = null;
      let branchTime = Infinity;

      for (const id of activeIds) {
        if (particles[id].branchTime < branchTime) {
          parentId = id;
          branchTime = particles[id].branchTime;
        }
      }

      if (parentId === null || branchTime > time) break;

      const parent = particles[parentId];

      activeIds.delete(parentId);

      const branchPosition =
        processType === `bm`
          ? getParticlePosition(parent, branchTime, diffusion, drift)
          : [...parent.position];

      parent.position = [...branchPosition];

      if (parent.path.at(-1)?.[0] !== branchTime) {
        parent.path.push([branchTime, [...branchPosition]]);
      }

      for (let childIndex = 0; childIndex < 2; childIndex += 1) {
        const childId = particles.length;

        particles.push(
          createParticle(
            parentId,
            parent.generation + 1,
            branchTime,
            branchPosition,
            splitSeed(parent.seed, childIndex + 1),
            branchingRate,
          ),
        );
        activeIds.add(childId);
      }
    }

    for (const particleId of activeIds) {
      const particle = particles[particleId];

      if (processType == `bm`) {
        particle.position = getParticlePosition(
          particle,
          time,
          diffusion,
          drift,
        );
      } else if (processType == `rw`) {
        particle.position[boundedRandom(particle.position.length)] +=
          -1 + 2 * binaryRandom();
      }

      particle.path.push([time, [...particle.position]]);
    }

    let minPosition = Array(dimensions).fill(Infinity);
    let maxPosition = Array(dimensions).fill(-Infinity);

    for (const particleId of activeIds) {
      const position = particles[particleId].position;

      for (
        let dimensionIndex = 0;
        dimensionIndex < dimensions;
        dimensionIndex++
      ) {
        minPosition[dimensionIndex] = Math.min(
          minPosition[dimensionIndex],
          position[dimensionIndex],
        );
        maxPosition[dimensionIndex] = Math.max(
          maxPosition[dimensionIndex],
          position[dimensionIndex],
        );
      }
    }

    populationHistory.push([time, activeIds.size]);
    frontierHistory.push([time, minPosition, maxPosition]);
  }

  let meanFinalPosition = Array(dimensions).fill(0);
  let sumOfSquares = Array(dimensions).fill(0);
  let minFinalPosition = Array(dimensions).fill(Infinity);
  let maxFinalPosition = Array(dimensions).fill(-Infinity);

  let index = 0;
  for (const particleId of activeIds) {
    const position = particles[particleId].position;

    for (
      let dimensionIndex = 0;
      dimensionIndex < dimensions;
      dimensionIndex++
    ) {
      const currentPosition = position[dimensionIndex];
      minFinalPosition[dimensionIndex] = Math.min(
        minFinalPosition[dimensionIndex],
        currentPosition,
      );
      maxFinalPosition[dimensionIndex] = Math.max(
        maxFinalPosition[dimensionIndex],
        currentPosition,
      );

      const difference = currentPosition - meanFinalPosition[dimensionIndex];
      meanFinalPosition[dimensionIndex] += difference / (index + 1);

      const newDifference = currentPosition - meanFinalPosition[dimensionIndex];
      sumOfSquares[dimensionIndex] += difference * newDifference;
    }
    index++;
  }

  const variance = sumOfSquares.map(
    (sumOfSquare) => sumOfSquare / activeIds.size,
  );

  let maximumGeneration = 0;
  let minPosition = Array(dimensions).fill(Infinity);
  let maxPosition = Array(dimensions).fill(-Infinity);

  for (const particle of particles) {
    maximumGeneration = Math.max(maximumGeneration, particle.generation);

    for (const [, position] of particle.path) {
      for (
        let dimensionIndex = 0;
        dimensionIndex < dimensions;
        dimensionIndex++
      ) {
        minPosition[dimensionIndex] = Math.min(
          minPosition[dimensionIndex],
          position[dimensionIndex],
        );

        maxPosition[dimensionIndex] = Math.max(
          maxPosition[dimensionIndex],
          position[dimensionIndex],
        );
      }
    }
  }

  return {
    parameters: {
      processType,
      duration,
      dt,
      diffusion,
      drift,
      branchingRate,
      initialParticles,
      maxParticles,
      seed,
    },

    particles: particles.map((particle, id) => ({
      id,
      parentId: particle.parentId,
      generation: particle.generation,
      birthTime: particle.birthTime,
      path: particle.path,
    })),

    populationHistory,
    frontierHistory,

    summary: {
      finalPopulation: activeIds.size,
      totalParticlesCreated: particles.length,
      maximumGeneration,
      meanFinalPosition: meanFinalPosition,
      standardDeviation: variance.map((value) => Math.sqrt(value)),
      minPosition,
      maxPosition,
      minFinalPosition,
      maxFinalPosition,
      populationCapReached:
        maxParticles !== 0 && activeIds.size >= maxParticles,
      steps,
    },
  };
}
