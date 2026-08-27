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

function createBinaryRandom(integerRandom) {
  return function nextBinary() {
    return integerRandom() & 1;
  };
}

function createUniformRandom(boundedRandom) {
  return function nextUniform() {
    return (boundedRandom() >>> 0) / 4294967296;
  };
}

// Random Integer in range [0, range - 1]
function createBoundedRandom(uniformRandom) {
  return function nextBounded(range) {
    return Math.floor(uniformRandom() * range);
  };
}

function createNormalRandom(uniformRandom) {
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

function createParticle(parentId, generation, time, position) {
  const initialPosition = [...position];

  return {
    parentId,
    generation,
    birthTime: time,
    position: initialPosition,
    path: [[time, [...position]]],
  };
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
  const binaryRandom = createBinaryRandom(integerRandom);
  const uniformRandom = createUniformRandom(integerRandom);
  const boundedRandom = createBoundedRandom(uniformRandom);
  const normalRandom = createNormalRandom(uniformRandom);

  const steps = Math.floor(duration / dt);

  const branchProbability = 1 - Math.exp(-branchingRate * dt);

  const particles = [];
  let activeIds = [];

  for (let index = 0; index < initialParticles; index += 1) {
    particles.push(createParticle(null, 0, 0, startingPosition));
    activeIds.push(index);
  }

  const populationHistory = [[0, activeIds.length]];
  const frontierHistory = [[0, [...startingPosition], [...startingPosition]]];

  for (let step = 1; step <= steps; step += 1) {
    const time = step * dt;

    for (const particleId of activeIds) {
      const particle = particles[particleId];

      if (processType == `bm`) {
        for (let i = 0; i < particle.position.length; i++) {
          if (processType == `bm`) {
            particle.position[i] +=
              drift[i] * dt + diffusion[i] * Math.sqrt(dt) * normalRandom();
          }
        }
      } else if (processType == `rw`) {
        particle.position[boundedRandom(particle.position.length)] +=
          -1 + 2 * binaryRandom();
      }

      particle.path.push([time, [...particle.position]]);
    }

    const nextActive = [];
    let activeCount = activeIds.length;

    for (const particleId of activeIds) {
      const parent = particles[particleId];

      const shouldBranch =
        (activeCount < maxParticles || maxParticles == 0) &&
        uniformRandom() < branchProbability;

      if (!shouldBranch) {
        nextActive.push(particleId);
        continue;
      }

      activeCount += 1;

      for (let childIndex = 0; childIndex < 2; childIndex += 1) {
        const childId = particles.length;

        particles.push(
          createParticle(
            particleId,
            parent.generation + 1,
            time,
            parent.position,
          ),
        );

        nextActive.push(childId);
      }
    }

    activeIds = nextActive;

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

    populationHistory.push([time, activeIds.length]);
    frontierHistory.push([time, minPosition, maxPosition]);
  }

  let meanFinalPosition = Array(dimensions).fill(0);
  let sumOfSquares = Array(dimensions).fill(0);
  let minFinalPosition = Array(dimensions).fill(Infinity);
  let maxFinalPosition = Array(dimensions).fill(-Infinity);

  for (let index = 0; index < activeIds.length; index += 1) {
    const position = particles[activeIds[index]].position;

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
  }

  const variance = sumOfSquares.map(
    (sumOfSquare) => sumOfSquare / activeIds.length,
  );

  let maximumGeneration = 0;

  for (const particle of particles) {
    maximumGeneration = Math.max(maximumGeneration, particle.generation);
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
      finalPopulation: activeIds.length,
      totalParticlesCreated: particles.length,
      maximumGeneration,
      meanFinalPosition: meanFinalPosition,
      standardDeviation: variance.map((value) => Math.sqrt(value)),
      minFinalPosition,
      maxFinalPosition,
      populationCapReached:
        maxParticles !== 0 && activeIds.length >= maxParticles,
      steps,
    },
  };
}
