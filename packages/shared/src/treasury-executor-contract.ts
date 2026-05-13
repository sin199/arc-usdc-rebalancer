export const treasuryExecutorContractAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'asset_',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'InvalidRecipient',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InsufficientAllowance',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotOwner',
    inputs: [],
  },
  {
    type: 'error',
    name: 'TransferFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ZeroAmount',
    inputs: [],
  },
  {
    type: 'event',
    name: 'TopUpExecuted',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
      },
    ],
  },
  {
    type: 'event',
    name: 'TrimExecuted',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        type: 'address',
        indexed: true,
      },
      {
        name: 'recipient',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
      },
    ],
  },
  {
    type: 'function',
    name: 'asset',
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
    name: 'executeTopUp',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'amount',
        type: 'uint256',
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeTrim',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'recipient',
        type: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
      },
    ],
    outputs: [],
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
] as const
