export const treasuryPolicyContractAbi = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'InvalidPolicy',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotOwner',
    inputs: [],
  },
  {
    type: 'event',
    name: 'PolicyUpdated',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        type: 'address',
        indexed: true,
      },
      {
        name: 'minThreshold',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'targetBalance',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'maxRebalanceAmount',
        type: 'uint256',
        indexed: false,
      },
    ],
  },
  {
    type: 'function',
    name: 'getPolicy',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'currentMinThreshold',
        type: 'uint256',
      },
      {
        name: 'currentTargetBalance',
        type: 'uint256',
      },
      {
        name: 'currentMaxRebalanceAmount',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'function',
    name: 'maxRebalanceAmount',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'function',
    name: 'minThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
      },
    ],
  },
  {
    type: 'function',
    name: 'setPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'newMinThreshold',
        type: 'uint256',
      },
      {
        name: 'newTargetBalance',
        type: 'uint256',
      },
      {
        name: 'newMaxRebalanceAmount',
        type: 'uint256',
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'targetBalance',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
      },
    ],
  },
] as const

export const treasuryPolicyUpdatedEvent = treasuryPolicyContractAbi[3]

