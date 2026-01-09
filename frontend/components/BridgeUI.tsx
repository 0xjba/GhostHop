'use client';

import React, { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useReadContract, useChainId } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { parseUnits, formatUnits } from 'viem';
import { 
  GHOSTHOP_ADAPTER_ADDRESS_SEPOLIA, 
  ACROSS_SPOKE_POOL_SEPOLIA, 
  getAcrossQuote, 
  encodeGhostHopMessage 
} from '../lib/across';
import { TEN_BRIDGE_ABI, ACROSS_SPOKE_POOL_ABI } from '../constants/abis';
import { Loader2, ArrowRightLeft, AlertCircle } from 'lucide-react';

const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TEN_BRIDGE_SEPOLIA = "YOUR_TEN_BRIDGE_ADDRESS"; // TODO: Replace

interface AcrossQuote {
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  inputAmount: string;
  outputAmount: string;
  destinationChainId: number;
  exclusiveRelayer: `0x${string}`;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityDeadline: number;
  relayerFeePct: string;
}

export default function BridgeUI() {
  const { address: evmAddress } = useAccount();
  const chainId = useChainId();

  const [amount, setAmount] = useState('');
  const [targetL2Address, setTargetL2Address] = useState('');
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<AcrossQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-flight checks (Sepolia only for now)
  const { data: isPaused } = useReadContract({
    address: TEN_BRIDGE_SEPOLIA as `0x${string}`,
    abi: TEN_BRIDGE_ABI,
    functionName: 'paused',
    chainId: 11155111, // Sepolia
  });

  const { writeContractAsync } = useWriteContract();

  const handleFetchQuote = async () => {
    if (!amount || isNaN(Number(amount))) return;
    setLoading(true);
    setError(null);
    try {
      const q = await getAcrossQuote({
        originChainId: chainId,
        destinationChainId: 11155111, // Eth Sepolia
        inputToken: chainId === 84532 ? BASE_SEPOLIA_USDC : SEPOLIA_USDC,
        outputToken: SEPOLIA_USDC,
        amount: parseUnits(amount, 6).toString(),
      });
      setQuote(q);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error fetching quote');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (amount && Number(amount) > 0) handleFetchQuote();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, chainId]);

  const handleBridge = async () => {
    if (!quote || !targetL2Address) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Encode Message
      const message = encodeGhostHopMessage(targetL2Address);

      // 2. Execute Deposit on SpokePool
      const tx = await writeContractAsync({
        address: ACROSS_SPOKE_POOL_SEPOLIA as `0x${string}`,
        abi: ACROSS_SPOKE_POOL_ABI,
        functionName: 'depositV3',
        args: [
          evmAddress as `0x${string}`,           // depositor
          GHOSTHOP_ADAPTER_ADDRESS_SEPOLIA as `0x${string}`, // recipient (GhostHopAdapter)
          quote.inputToken,                      // inputToken
          quote.outputToken,                     // outputToken
          BigInt(quote.inputAmount),             // inputAmount
          BigInt(quote.outputAmount),            // outputAmount
          BigInt(quote.destinationChainId),      // destinationChainId
          quote.exclusiveRelayer,                // exclusiveRelayer
          quote.quoteTimestamp,                  // quoteTimestamp
          quote.fillDeadline,                    // fillDeadline
          quote.exclusivityDeadline,             // exclusivityDeadline
          message,                               // message (encoded L2 address)
        ],
      });

      console.log("Bridge initiated:", tx);
      alert("Bridge Transaction Sent!");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error during bridge');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg border border-gray-100">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          👻 GhostHop
        </h1>
        <ConnectButton showBalance={false} chainStatus="none" />
      </div>

      <div className="space-y-4">
        {/* Source Chain Info */}
        <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
          Source: {chainId === 84532 ? 'Base Sepolia' : 'Other Chain'}
        </div>

        {/* Input Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (USDC)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="0.00"
          />
        </div>

        {/* Target L2 Address */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target TEN L2 Address</label>
          <input
            type="text"
            value={targetL2Address}
            onChange={(e) => setTargetL2Address(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
            placeholder="0x..."
          />
        </div>

        {/* Quote Display */}
        {quote && (
          <div className="p-4 bg-gray-50 rounded-lg space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Relayer Fee:</span>
              <span>{formatUnits(BigInt(quote.relayerFeePct), 16)}%</span>
            </div>
            <div className="flex justify-between font-medium text-gray-800">
              <span>You will receive approx:</span>
              <span>{formatUnits(BigInt(quote.outputAmount), 6)} USDC</span>
            </div>
          </div>
        )}

        {/* Pre-flight Warnings */}
        {isPaused && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} /> Ten Bridge is currently paused.
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs break-all">
            {error}
          </div>
        )}

        {/* Solana Toggle Hint */}
        <div className="flex justify-center pt-2">
          <WalletMultiButton className="!bg-purple-600 !h-10 !text-sm" />
          <span className="ml-2 text-xs text-gray-400 self-center">(Mainnet Only)</span>
        </div>

        {/* Bridge Button */}
        <button
          onClick={handleBridge}
          disabled={loading || !quote || !targetL2Address || isPaused}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" /> : <ArrowRightLeft size={20} />}
          Bridge to TEN
        </button>
      </div>
    </div>
  );
}

