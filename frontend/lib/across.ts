import { encodeAbiParameters } from 'viem';
import { ADDRESSES } from '../constants/addresses';

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
  amount: string;
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

export const getAcrossSolanaDepositTx = async (params: any) => {
  const response = await fetch('https://across.to/api/solana/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Across Solana API Error: ${errorText}`);
  }

  return response.json();
};
