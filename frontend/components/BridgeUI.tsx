'use client';

import React, { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useReadContract, useChainId, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import { toByteArray } from 'base64-js';
import { parseUnits, formatUnits } from 'viem';
import { getAcrossQuote, encodeGhostHopMessage, getAcrossSolanaDepositTx } from '../lib/across';
import { ADDRESSES, CHAIN_IDS } from '../constants/addresses';
import { TEN_BRIDGE_ABI, ACROSS_SPOKE_POOL_ABI, ERC20_TOKEN_ROLE, NATIVE_TOKEN_ROLE, ERC20_ABI } from '../constants/abis';
import { Loader2, ArrowRightLeft, AlertCircle } from 'lucide-react';

interface AcrossQuote {
  inputToken: string;
  outputToken: string;
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
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { publicKey: solanaAddress, signTransaction, connected: isSolanaConnected } = useWallet();
  const { connection } = useConnection();
  const currentChainId = useChainId();
  const { switchChain } = useSwitchChain();

  // 1. STATE: Source Chain Selection (Default to Base Sepolia)
  const [sourceChainId, setSourceChainId] = useState<number>(CHAIN_IDS.BASE_SEPOLIA);
  
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState<'USDC' | 'ETH'>('USDC');
  const [targetL2Address, setTargetL2Address] = useState('');
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<AcrossQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived Helpers
  const isSolanaSource = sourceChainId === CHAIN_IDS.SOLANA_MAINNET;
  
  // 2. LOGIC: Determine Input Token based on SELECTED State
  const getInputTokenAddress = () => {
    if (isSolanaSource) return ADDRESSES.USDC.SOLANA_MAINNET;
    if (token === 'ETH') return ADDRESSES.NATIVE_ETH;
    
    switch (sourceChainId) {
      case CHAIN_IDS.BASE_SEPOLIA: return ADDRESSES.USDC.BASE_SEPOLIA;
      default: return undefined;
    }
  };

  const inputTokenAddress = getInputTokenAddress();

  // Dynamic Decimals (Only fetch if EVM + Not ETH)
  const { data: fetchedDecimals } = useReadContract({
    address: inputTokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'decimals',
    chainId: sourceChainId,
    query: {
      enabled: !isSolanaSource && token !== 'ETH' && !!inputTokenAddress,
    }
  });

  const tokenDecimals = isSolanaSource 
    ? 6 
    : (token === 'ETH' ? 18 : (fetchedDecimals ? Number(fetchedDecimals) : 18));

  // Pre-flight checks: Whitelist and Paused
  const destTokenAddress = token === 'USDC' ? ADDRESSES.USDC.ETHEREUM_SEPOLIA : ADDRESSES.NATIVE_ETH;
  const roleToCheck = token === 'USDC' ? ERC20_TOKEN_ROLE : NATIVE_TOKEN_ROLE;

  const { data: isPaused } = useReadContract({
    address: ADDRESSES.TEN_BRIDGE_L1_SEPOLIA,
    abi: TEN_BRIDGE_ABI,
    functionName: 'paused',
    chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
    query: {
      enabled: !!ADDRESSES.TEN_BRIDGE_L1_SEPOLIA,
    }
  });

  const { data: isWhitelisted } = useReadContract({
    address: ADDRESSES.TEN_BRIDGE_L1_SEPOLIA,
    abi: TEN_BRIDGE_ABI,
    functionName: 'hasRole',
    args: [roleToCheck as `0x${string}`, destTokenAddress],
    chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
    query: {
      enabled: !!ADDRESSES.TEN_BRIDGE_L1_SEPOLIA && !!destTokenAddress,
    }
  });

  // 3. QUOTE: Fetch based on Selection State
  const handleFetchQuote = async () => {
    if (!amount || isNaN(Number(amount)) || !inputTokenAddress) return;
    setLoading(true);
    setError(null);
    try {
      const q = await getAcrossQuote({
        originChainId: sourceChainId,
        destinationChainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
        inputToken: inputTokenAddress,
        outputToken: token === 'USDC' ? ADDRESSES.USDC.ETHEREUM_SEPOLIA : ADDRESSES.NATIVE_ETH,
        amount: parseUnits(amount, tokenDecimals).toString(),
      });
      setQuote(q);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error fetching quote');
      setQuote(null);
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
  }, [amount, sourceChainId, token]);

  const { writeContractAsync } = useWriteContract();

  // 4. EXECUTION: Handle Switch vs Bridge
  const handleAction = async () => {
    setError(null);

    if (isSolanaSource) {
      if (!isSolanaConnected) return alert("Please connect your Solana Wallet");
      handleBridgeSolana();
      return;
    }

    if (!isEvmConnected) return; // Handled by ConnectButton
    
    if (currentChainId !== sourceChainId) {
      try {
        switchChain({ chainId: sourceChainId });
      } catch (e) {
        setError("Failed to switch network. Please switch manually.");
      }
      return;
    }

    handleBridgeEvm();
  };

  const handleBridgeSolana = async () => {
    if (!quote || !targetL2Address || !signTransaction || !solanaAddress) return;
    setLoading(true);
    try {
      const message = encodeGhostHopMessage(targetL2Address);
      if (!ADDRESSES.GHOSTHOP_ADAPTER_SEPOLIA) throw new Error("GhostHop Adapter address not configured in .env");

      const { transaction: serializedTx } = await getAcrossSolanaDepositTx({
        originChainId: CHAIN_IDS.SOLANA_MAINNET,
        destinationChainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
        inputToken: ADDRESSES.USDC.SOLANA_MAINNET,
        outputToken: ADDRESSES.USDC.ETHEREUM_SEPOLIA,
        amount: quote.inputAmount,
        recipient: ADDRESSES.GHOSTHOP_ADAPTER_SEPOLIA,
        message: message,
        relayerFeePct: quote.relayerFeePct,
        quoteTimestamp: quote.quoteTimestamp,
        depositor: solanaAddress.toBase58(),
      });

      const transaction = VersionedTransaction.deserialize(toByteArray(serializedTx));
      const signedTx = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature);
      
      console.log("Solana Bridge initiated:", signature);
      alert("Solana Bridge Transaction Sent!");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBridgeEvm = async () => {
    if (!quote || !targetL2Address || !evmAddress) return;
    setLoading(true);
    try {
      const message = encodeGhostHopMessage(targetL2Address);
      if (!ADDRESSES.GHOSTHOP_ADAPTER_SEPOLIA) throw new Error("GhostHop Adapter address not configured in .env");
      
      const isEth = quote.inputToken === ADDRESSES.NATIVE_ETH;

      const tx = await writeContractAsync({
        address: ADDRESSES.ACROSS_SPOKE_POOL_SEPOLIA,
        abi: ACROSS_SPOKE_POOL_ABI,
        functionName: 'depositV3',
        args: [
          evmAddress as `0x${string}`,
          ADDRESSES.GHOSTHOP_ADAPTER_SEPOLIA as `0x${string}`,
          quote.inputToken as `0x${string}`,
          quote.outputToken as `0x${string}`,
          BigInt(quote.inputAmount),
          BigInt(quote.outputAmount),
          BigInt(quote.destinationChainId),
          quote.exclusiveRelayer,
          quote.quoteTimestamp,
          quote.fillDeadline,
          quote.exclusivityDeadline,
          message,
        ],
        value: isEth ? BigInt(quote.inputAmount) : BigInt(0),
      });

      console.log("EVM Bridge initiated:", tx);
      alert("EVM Bridge Transaction Sent!");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const getButtonText = () => {
    if (loading) return "Processing...";
    if (!quote) return "Enter Amount";
    if (isPaused) return "Bridge Paused";
    if (isWhitelisted === false) return "Token Not Whitelisted";
    
    if (isSolanaSource) {
      return isSolanaConnected ? "Bridge to TEN" : "Connect Solana Wallet";
    } else {
      if (!isEvmConnected) return "Connect Wallet";
      if (currentChainId !== sourceChainId) return "Switch Network";
      return "Bridge to TEN";
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg border border-gray-100">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          👻 GhostHop
        </h1>
        <div className="flex flex-col gap-2 items-end">
          <ConnectButton showBalance={false} chainStatus="none" />
          <WalletMultiButton className="!bg-purple-600 !h-8 !text-xs !py-0 !px-4" />
        </div>
      </div>

      <div className="space-y-4">
        {/* Network Selector */}
        <div className="flex gap-2 mb-2">
          <select 
            value={sourceChainId}
            onChange={(e) => setSourceChainId(Number(e.target.value))}
            className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={CHAIN_IDS.BASE_SEPOLIA}>Base Sepolia</option>
            <option value={CHAIN_IDS.SOLANA_MAINNET}>Solana Mainnet</option>
          </select>
        </div>

        {/* Token Selector */}
        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
          <button
            onClick={() => setToken('USDC')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${token === 'USDC' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            USDC
          </button>
          <button
            onClick={() => setToken('ETH')}
            disabled={isSolanaSource}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${token === 'ETH' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            ETH
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount ({token})</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="0.00"
          />
        </div>

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

        {quote && (
          <div className="p-4 bg-gray-50 rounded-lg space-y-2 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Relayer Fee:</span>
              <span>{formatUnits(BigInt(quote.relayerFeePct), 16)}%</span>
            </div>
            <div className="flex justify-between font-medium text-gray-800">
              <span>You will receive approx:</span>
              <span>{formatUnits(BigInt(quote.outputAmount), token === 'USDC' ? 6 : 18)} {token}</span>
            </div>
          </div>
        )}

        {isPaused && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} /> Ten Bridge is paused.
          </div>
        )}

        {isWhitelisted === false && (
          <div className="p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} /> Token not whitelisted.
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs break-all">
            {error}
          </div>
        )}

        <div className="flex justify-center pt-2">
          <WalletMultiButton className="!bg-purple-600 !h-10 !text-sm" />
          <span className="ml-2 text-xs text-gray-400 self-center">(Mainnet Only)</span>
        </div>

        <button
          onClick={handleAction}
          disabled={loading || !quote || !targetL2Address || isPaused || isWhitelisted === false}
          className={`w-full py-4 font-bold rounded-lg transition-colors flex items-center justify-center gap-2
            ${(currentChainId !== sourceChainId && !isSolanaSource && isEvmConnected) 
              ? 'bg-amber-500 hover:bg-amber-600 text-white' 
              : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300'}
          `}
        >
          {loading ? <Loader2 className="animate-spin" /> : <ArrowRightLeft size={20} />}
          {getButtonText()}
        </button>
      </div>
    </div>
  );
}
