import { encodeAbiParameters } from 'viem';

export const GHOSTHOP_ADAPTER_ADDRESS_SEPOLIA = "YOUR_DEPLOYED_ADAPTER_ADDRESS"; // TODO: Replace after deployment
export const ACROSS_SPOKE_POOL_SEPOLIA = "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662";

export const encodeGhostHopMessage = (userL2Address: string) => {
  return encodeAbiParameters(
    [{ type: 'address' }],
    [userL2Address as `0x${string}`]
  );
};

export interface AcrossQuoteParams {
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
  amount: string; // amount in base units (string)
}

export const getAcrossQuote = async (params: AcrossQuoteParams) => {
  const url = new URL('https://across.to/api/suggested-fees');
  url.searchParams.append('originChainId', params.originChainId.toString());
  url.searchParams.append('destinationChainId', params.destinationChainId.toString());
  url.searchParams.append('token', params.inputToken);
  url.searchParams.append('amount', params.amount);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Across API Error: ${errorText}`);
  }

  return response.json();
};

