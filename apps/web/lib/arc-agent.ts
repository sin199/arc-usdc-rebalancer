import { keccak256, parseAbi, toHex } from 'viem'

export const arcAgentId = 4507n
export const arcAgentOwnerAddress = '0x4E5f09aE910b021A968f3cE37b76Af2E78a38632'
export const arcAgentValidatorAddress = '0xCe48C096DA131c728B886dC146aa8cDDB2E14c97'
export const arcAgentMetadataUri = 'https://web-eight-chi-99.vercel.app/dashboard'

export const arcAgentIdentityRegistryAddress = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
export const arcAgentReputationRegistryAddress = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const
export const arcAgentValidationRegistryAddress = '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as const

export const arcAgentValidationTag = 'kyc_verified'
export const arcAgentValidationRequestHash = keccak256(
  toHex(`kyc_verification_request_agent_${arcAgentId.toString()}`),
)

export const arcAgentIdentityAbi = parseAbi([
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function totalSupply() external view returns (uint256)',
])

export const arcAgentValidationAbi = parseAbi([
  'function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
])
