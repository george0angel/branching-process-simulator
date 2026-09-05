import { PriorityQueue } from "@datastructures-js/priority-queue";

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
    state = (state + 0x6d2b79f5) >>> 0;

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
  processType,
) {
  const branchTime = time + exponentialRandom(seed, branchRate);

  return {
    parentId,
    generation,
    birthTime: time,
    birthPosition: [...position],
    position: [...position],
    path: [[time, [...position]]],
    seed,
    motionSeed: splitSeed(seed, 0),
    branchTime: processType === `rw` ? Math.ceil(branchTime) : branchTime,
    integerValues: [Array(position.length).fill(0)],
    roots: [], // Index 0 for times in range [0,1] etc.
  };
}

const bridgeLevels = 14;

function createBridgeNode(leftTime, rightTime, left, right, seed) {
  return {
    leftTime,
    rightTime,
    left,
    right,
    seed,

    midpointTime: null,
    midpoint: null,

    leftChild: null,
    rightChild: null,
  };
}

function bridgeMidpoint(node, dimensions) {
  if (node.midpoint !== null) {
    return;
  }

  node.midpointTime = (node.leftTime + node.rightTime) / 2;

  const noise = normalRandomVector(node.seed, dimensions);

  const standardDeviation = Math.sqrt(node.rightTime - node.leftTime) / 2;

  node.midpoint = node.left.map(
    (value, i) => (value + node.right[i]) / 2 + standardDeviation * noise[i],
  );
}

function getBridgeChild(node, goLeft) {
  if (goLeft) {
    if (node.leftChild === null) {
      node.leftChild = createBridgeNode(
        node.leftTime,
        node.midpointTime,
        node.left,
        node.midpoint,
        splitSeed(node.seed, 0),
      );
    }

    return node.leftChild;
  } else {
    if (node.rightChild === null) {
      node.rightChild = createBridgeNode(
        node.midpointTime,
        node.rightTime,
        node.midpoint,
        node.right,
        splitSeed(node.seed, 1),
      );
    }

    return node.rightChild;
  }
}

function brownianBridgeValue(root, time, dimensions) {
  let node = root;

  for (let level = 0; level < bridgeLevels; level++) {
    if (time === node.leftTime) return node.left;

    if (time === node.rightTime) return node.right;

    bridgeMidpoint(node, dimensions);

    if (time === node.midpointTime) return node.midpoint;

    node = getBridgeChild(node, time < node.midpointTime);
  }

  // Final interpolation based on the distribution of the brownian bridge.
  const alpha = (time - node.leftTime) / (node.rightTime - node.leftTime);
  const noise = normalRandomVector(splitSeed(node.seed, 2), dimensions);
  const standardDeviation = Math.sqrt((node.rightTime - time) * alpha);

  return node.left.map(
    (value, i) =>
      value + alpha * (node.right[i] - value) + standardDeviation * noise[i],
  );
}

function brownianValue(particle, age) {
  const dimensions = particle.position.length;
  const rightAge = Math.ceil(age);

  while (particle.integerValues.length <= rightAge) {
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

  if (rightAge === age) return particle.integerValues[rightAge];

  const leftAge = rightAge - 1;
  const left = particle.integerValues[leftAge];
  const right = particle.integerValues[rightAge];

  let root = particle.roots[leftAge];

  if (root === undefined) {
    const intervalSeed = splitSeed(particle.motionSeed, leftAge);
    const bridgeSeed = splitSeed(intervalSeed, 1);

    root = createBridgeNode(
      0,
      1,
      Array(dimensions).fill(0),
      Array(dimensions).fill(0),
      splitSeed(bridgeSeed, 0),
    );

    particle.roots[leftAge] = root;
  }

  const unitAge = age - leftAge;
  const bridgeValue = brownianBridgeValue(root, unitAge, dimensions);

  return left.map(
    (value, i) => value + unitAge * (right[i] - value) + bridgeValue[i],
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
  const dt = processType === `rw` ? 1 : Number(payload.dt);
  const diffusion = payload.diffusion.map(Number);
  const drift = payload.drift.map(Number);
  const branchingRate = Number(payload.branchingRate);
  const initialParticles = Number(payload.initialParticles);
  const maxParticles = Number(payload.maxParticles);
  const startingPosition = payload.startingPosition.map(Number);
  const seed = Number(payload.seed);

  const dimensions = startingPosition.length;

  const binaryRandom = createBinaryRandom(splitSeed(seed, 0));
  const boundedRandom = createBoundedRandom(splitSeed(seed, 1));

  const particles = [];
  let activeIds = new Set();

  const branchQueue = new PriorityQueue((a, b) => {
    if (a.branchTime !== b.branchTime) {
      return a.branchTime - b.branchTime;
    }

    return a.particleId - b.particleId;
  });

  for (let index = 0; index < initialParticles; index += 1) {
    const particle = createParticle(
      null,
      0,
      0,
      startingPosition,
      splitSeed(seed, index + 3),
      branchingRate,
      processType,
    );

    particles.push(particle);
    activeIds.add(index);

    branchQueue.enqueue({
      particleId: index,
      branchTime: particle.branchTime,
    });
  }

  const steps = Math.floor(duration / dt);

  for (let step = 1; step <= steps; step += 1) {
    const time = step * dt;

    if (processType === `rw`) {
      for (const particleId of activeIds) {
        const particle = particles[particleId];

        particle.position[boundedRandom(particle.position.length)] +=
          -1 + 2 * binaryRandom();

        particle.path.push([time, [...particle.position]]);
      }
    }

    while (maxParticles === 0 || activeIds.size < maxParticles) {
      if (branchQueue.isEmpty()) break;

      const nextBranch = branchQueue.front();

      if (nextBranch.branchTime > time) break;

      branchQueue.dequeue();

      const parentId = nextBranch.particleId;
      const branchTime = nextBranch.branchTime;
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

        const child = createParticle(
          parentId,
          parent.generation + 1,
          branchTime,
          branchPosition,
          splitSeed(parent.seed, childIndex + 1),
          branchingRate,
          processType,
        );

        particles.push(child);
        activeIds.add(childId);

        branchQueue.enqueue({
          particleId: childId,
          branchTime: child.branchTime,
        });
      }
    }

    if (processType === `bm`) {
      for (const particleId of activeIds) {
        const particle = particles[particleId];

        particle.position = getParticlePosition(
          particle,
          time,
          diffusion,
          drift,
        );

        particle.path.push([time, [...particle.position]]);
      }
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

    summary: {
      startTime: 0,
      endTime: steps * dt,
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
