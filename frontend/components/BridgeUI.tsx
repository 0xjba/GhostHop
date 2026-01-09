'use client';

import React, { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useReadContract, useChainId, useSwitchChain, usePublicClient } from 'wagmi';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import { toByteArray } from 'base64-js';
import { parseUnits, formatUnits } from 'viem';
import { getAcrossQuote, encodeGhostHopMessage, getAcrossSolanaDepositTx } from '../lib/across';
import { ADDRESSES, CHAIN_IDS } from '../constants/addresses';
import { TEN_BRIDGE_ABI, ACROSS_SPOKE_POOL_ABI, ERC20_TOKEN_ROLE, NATIVE_TOKEN_ROLE, ERC20_ABI } from '../constants/abis';
import { Loader2, ArrowRightLeft, AlertCircle } from 'lucide-react';

interface AcrossQuote {
  inputToken: { address: string; symbol: string; decimals: number; chainId: number };
  outputToken: { address: string; symbol: string; decimals: number; chainId: number };
  inputAmount: string;
  outputAmount: string;
  exclusiveRelayer: `0x${string}`;
  timestamp: string;
  fillDeadline: string;
  exclusivityDeadline: number;
  relayFeePct: string;
  estimatedFillTimeSec: number;
  relayFeeTotal: string;
  relayerCapitalFee: { pct: string; total: string };
  relayerGasFee: { pct: string; total: string };
  lpFee: { pct: string; total: string };
}

export default function BridgeUI() {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { publicKey: solanaAddress, signTransaction, connected: isSolanaConnected } = useWallet();
  const { connection } = useConnection();
  const currentChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { setVisible: setSolanaModalVisible } = useWalletModal();
  const publicClient = usePublicClient();

  // 1. STATE: Source & Destination Selection
  const [sourceChainId, setSourceChainId] = useState<number>(CHAIN_IDS.BASE_SEPOLIA);
  const [destChainId, setDestChainId] = useState<number>(CHAIN_IDS.ETHEREUM_SEPOLIA); // Always TEN for now
  
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState<'USDC' | 'ETH'>('USDC');
  const [destToken, setDestToken] = useState<'USDC' | 'ETH'>('USDC');
  const [targetL2Address, setTargetL2Address] = useState('');
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<AcrossQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived Helpers
  const isSolanaSource = sourceChainId === CHAIN_IDS.SOLANA_DEVNET;
  const needsConnect = isSolanaSource ? !isSolanaConnected : !isEvmConnected;
  const needsSwitch = !isSolanaSource && isEvmConnected && currentChainId !== sourceChainId;
  
  // 2. LOGIC: Determine Input Token based on SELECTED State
  const getInputTokenAddress = () => {
    if (isSolanaSource) return ADDRESSES.USDC.SOLANA_DEVNET;
    
    if (token === 'ETH') {
      switch (sourceChainId) {
        case CHAIN_IDS.BASE_SEPOLIA: return ADDRESSES.ETH.BASE_SEPOLIA;
        case CHAIN_IDS.ARBITRUM_SEPOLIA: return ADDRESSES.ETH.ARBITRUM_SEPOLIA;
        case CHAIN_IDS.OPTIMISM_SEPOLIA: return ADDRESSES.ETH.OPTIMISM_SEPOLIA;
        default: return undefined;
      }
    }
    
    switch (sourceChainId) {
      case CHAIN_IDS.BASE_SEPOLIA: return ADDRESSES.USDC.BASE_SEPOLIA;
      case CHAIN_IDS.ARBITRUM_SEPOLIA: return ADDRESSES.USDC.ARBITRUM_SEPOLIA;
      case CHAIN_IDS.OPTIMISM_SEPOLIA: return ADDRESSES.USDC.OPTIMISM_SEPOLIA;
      default: return undefined;
    }
  };

  const inputTokenAddress = getInputTokenAddress();

  const getSpokePoolAddress = () => {
    switch (sourceChainId) {
      case CHAIN_IDS.ARBITRUM_SEPOLIA:
        return ADDRESSES.ACROSS_SPOKE_POOL_ARBITRUM_SEPOLIA;
      case CHAIN_IDS.BASE_SEPOLIA:
        return ADDRESSES.ACROSS_SPOKE_POOL_BASE_SEPOLIA;
      default:
        return ADDRESSES.ACROSS_SPOKE_POOL_SEPOLIA;
    }
  };
  const spokePoolAddress = getSpokePoolAddress();

  // 2. READ: Check Allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: inputTokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [evmAddress as `0x${string}`, spokePoolAddress as `0x${string}`],
    chainId: sourceChainId,
    query: {
      enabled: !isSolanaSource && token !== 'ETH' && !!evmAddress && !!inputTokenAddress,
    },
  });

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
  const destTokenAddress = destToken === 'USDC' ? ADDRESSES.USDC.ETHEREUM_SEPOLIA : ADDRESSES.ETH.ETHEREUM_SEPOLIA;
  const roleToCheck = destToken === 'USDC' ? ERC20_TOKEN_ROLE : NATIVE_TOKEN_ROLE;

  const { data: isPaused } = useReadContract({
    address: ADDRESSES.TEN_BRIDGE_L1 as `0x${string}`,
    abi: TEN_BRIDGE_ABI,
    functionName: 'paused',
    chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
    query: {
      enabled: !!ADDRESSES.TEN_BRIDGE_L1,
    }
  });

  /*
  const { data: isWhitelisted } = useReadContract({
    address: ADDRESSES.TEN_BRIDGE_L1 as `0x${string}`,
    abi: TEN_BRIDGE_ABI,
    functionName: 'hasRole',
    args: [roleToCheck as `0x${string}`, destTokenAddress],
    chainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
    query: {
      enabled: !!ADDRESSES.TEN_BRIDGE_L1 && !!destTokenAddress,
    }
  });
  */
  const isWhitelisted = true; // Temporary bypass

  // 3. QUOTE: Fetch based on Selection State
  const handleFetchQuote = async () => {
    if (!amount || isNaN(Number(amount)) || !inputTokenAddress) return;
    setLoading(true);
    setError(null);
    try {
      const inputAmountRaw = parseUnits(amount, tokenDecimals).toString();
      const q = await getAcrossQuote({
        originChainId: sourceChainId,
        destinationChainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
        inputToken: inputTokenAddress,
        outputToken: destToken === 'USDC' ? ADDRESSES.USDC.ETHEREUM_SEPOLIA : ADDRESSES.ETH.ETHEREUM_SEPOLIA,
        amount: inputAmountRaw,
      });
      // Manually add inputAmount to the quote object for easier handling
      setQuote({ ...q, inputAmount: inputAmountRaw });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error fetching quote');
      setQuote(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Clear quote immediately when dependencies change to avoid race conditions
    setQuote(null);
    setError(null);

    const timer = setTimeout(() => {
      if (amount && Number(amount) > 0) handleFetchQuote();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, sourceChainId, token, destToken]);

  const { writeContractAsync } = useWriteContract();

  // Helper to determine if we need approval
  const needsApproval = 
    !isSolanaSource && 
    token !== 'ETH' && 
    quote && 
    allowance !== undefined && 
    allowance < BigInt(quote.inputAmount);

  const handleApprove = async () => {
    if (!inputTokenAddress || !spokePoolAddress || !quote || !publicClient) return;
    setLoading(true);
    try {
      const hash = await writeContractAsync({
        address: inputTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spokePoolAddress as `0x${string}`, BigInt(quote.inputAmount)],
      });
      console.log("Approve Tx Hash:", hash);

      // Wait for the transaction to be confirmed
      await publicClient.waitForTransactionReceipt({ hash });

      await refetchAllowance();
      alert("Approval Confirmed! You can now Bridge.");
    } catch (e: any) {
      setError(e.message || "Approval failed");
    } finally {
      setLoading(false);
    }
  };

  // 4. EXECUTION: Handle Switch vs Bridge
  const handleAction = async () => {
    setError(null);

    if (isSolanaSource) {
      if (!isSolanaConnected) {
        setSolanaModalVisible(true);
        return;
      }
      handleBridgeSolana();
      return;
    }

    if (!isEvmConnected) {
      openConnectModal?.();
      return;
    }
    
    if (currentChainId !== sourceChainId) {
      try {
        console.log("Switching to chain:", sourceChainId);
        await switchChainAsync({ chainId: sourceChainId });
      } catch (e: any) {
        console.error("Switch Chain Error:", e);
        setError(`Failed to switch network: ${e.message || "Please switch manually."}`);
      }
      return;
    }

    if (needsApproval) {
      await handleApprove();
      return;
    }

    handleBridgeEvm();
  };

  const handleBridgeSolana = async () => {
    if (!quote || !targetL2Address || !signTransaction || !solanaAddress) return;
    setLoading(true);
    try {
      const message = encodeGhostHopMessage(targetL2Address);
      if (!ADDRESSES.GHOSTHOP_ADAPTER) throw new Error("GhostHop Adapter address not configured in .env");

      const { transaction: serializedTx } = await getAcrossSolanaDepositTx({
        originChainId: CHAIN_IDS.SOLANA_DEVNET,
        destinationChainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
        inputToken: ADDRESSES.USDC.SOLANA_DEVNET,
        outputToken: destToken === 'USDC' ? ADDRESSES.USDC.ETHEREUM_SEPOLIA : ADDRESSES.ETH.ETHEREUM_SEPOLIA,
        amount: quote.inputAmount,
        recipient: ADDRESSES.GHOSTHOP_ADAPTER,
        message: message,
        relayerFeePct: quote.relayFeePct,
        quoteTimestamp: quote.timestamp,
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
    if (!quote || !targetL2Address || !evmAddress || !publicClient) return;

    // Safety check to prevent bridging if the quote's chain doesn't match the selected chain
    if (quote.inputToken.chainId !== sourceChainId) {
      setError("Quote mismatch. Please wait for the new quote to load.");
      return;
    }

    setLoading(true);
    try {
      const message = encodeGhostHopMessage(targetL2Address);
      if (!ADDRESSES.GHOSTHOP_ADAPTER) throw new Error("GhostHop Adapter address not configured in .env");
      
      const isEth = token === 'ETH';

      const hash = await writeContractAsync({
        address: spokePoolAddress as `0x${string}`,
        abi: ACROSS_SPOKE_POOL_ABI,
        functionName: 'depositV3',
        args: [
          evmAddress as `0x${string}`,
          ADDRESSES.GHOSTHOP_ADAPTER as `0x${string}`,
          quote.inputToken.address as `0x${string}`,
          quote.outputToken.address as `0x${string}`,
          BigInt(quote.inputAmount),
          BigInt(quote.outputAmount),
          BigInt(quote.outputToken.chainId),
          quote.exclusiveRelayer,
          Number(quote.timestamp),
          Number(quote.fillDeadline),
          quote.exclusivityDeadline,
          message,
        ],
        value: isEth ? BigInt(quote.inputAmount) : BigInt(0),
      });

      console.log("EVM Bridge initiated hash:", hash);
      await publicClient.waitForTransactionReceipt({ hash });
      alert("EVM Bridge Transaction Confirmed!");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const getButtonText = () => {
    if (loading) return "Processing...";
    if (isPaused) return "Bridge Paused";
    
    if (isSolanaSource) {
      if (!isSolanaConnected) return "Connect Solana Wallet";
    } else {
      if (!isEvmConnected) return "Connect Wallet";
      if (currentChainId !== sourceChainId) return "Switch Network";
    }
    
    if (!quote) return "Enter Amount";
    // if (isWhitelisted === false) return "Token Not Whitelisted";
    
    if (needsApproval) return `Approve ${token}`;

    return "Bridge to TEN";
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

      <div className="space-y-2">
        {/* FROM BLOCK */}
        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-semibold text-gray-500">From</label>
            <span className="text-xs text-gray-400">Balance: 0</span>
          </div>
          <div className="flex gap-4 items-center">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-2xl font-bold outline-none placeholder-gray-300"
              placeholder="0.00"
            />
            <div className="flex flex-col gap-1 min-w-[140px]">
              <select 
                value={token}
                onChange={(e) => {
                  const val = e.target.value as 'USDC' | 'ETH';
                  setToken(val);
                  setDestToken(val); // Keep in sync for GhostHop
                }}
                className="p-1 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 outline-none"
              >
                <option value="USDC">USDC</option>
                <option value="ETH" disabled={isSolanaSource}>ETH</option>
              </select>
              <select 
                value={sourceChainId}
                onChange={(e) => setSourceChainId(Number(e.target.value))}
                className="p-1 bg-white border border-gray-200 rounded-lg text-xs text-gray-500 outline-none"
              >
                <option value={CHAIN_IDS.BASE_SEPOLIA}>Base Sepolia</option>
                <option value={CHAIN_IDS.ARBITRUM_SEPOLIA}>Arbitrum Sepolia</option>
                <option value={CHAIN_IDS.SOLANA_DEVNET}>Solana Devnet</option>
              </select>
            </div>
          </div>
          <div className="text-xs text-gray-400 mt-1">$0.00</div>
        </div>

        {/* SWAP ICON */}
        <div className="flex justify-center -my-3 relative z-10">
          <div className="bg-white p-2 rounded-xl border border-gray-100 shadow-sm text-gray-400">
            <ArrowRightLeft size={16} />
          </div>
        </div>

        {/* TO BLOCK */}
        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-semibold text-gray-500">To</label>
            <span className="text-xs text-gray-400">TEN Network</span>
          </div>
          <div className="flex gap-4 items-center">
            <div className="flex-1 text-2xl font-bold text-gray-400">
              {quote ? formatUnits(BigInt(quote.outputAmount), destToken === 'USDC' ? 6 : 18) : '0.00'}
            </div>
            <div className="flex flex-col gap-1 min-w-[140px]">
              <select 
                value={destToken}
                onChange={(e) => setDestToken(e.target.value as 'USDC' | 'ETH')}
                className="p-1 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 outline-none"
              >
                <option value="USDC">USDC</option>
                <option value="ETH">ETH</option>
              </select>
              <select 
                disabled
                className="p-1 bg-gray-100 border border-gray-200 rounded-lg text-xs text-gray-500 outline-none cursor-not-allowed"
              >
                <option>TEN (Sepolia)</option>
              </select>
            </div>
          </div>
          <div className="text-xs text-gray-400 mt-1">$0.00</div>
        </div>

        {/* TARGET ADDRESS */}
        <div className="mt-4">
          <label className="block text-xs font-semibold text-gray-500 mb-1 ml-1 uppercase">Target TEN L2 Address</label>
          <input
            type="text"
            value={targetL2Address}
            onChange={(e) => setTargetL2Address(e.target.value)}
            className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-xs"
            placeholder="0x..."
          />
        </div>

        {quote && (
          <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-3 text-sm">
            {/* Route */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-gray-500">
                <ArrowRightLeft size={14} className="text-gray-400" />
                <span>Route</span>
              </div>
              <div className="flex items-center gap-1.5 font-medium text-gray-700">
                <div className="w-5 h-5 bg-emerald-400 rounded-full flex items-center justify-center text-[10px] text-white font-bold">
                  ✕
                </div>
                <span>Across V4</span>
              </div>
            </div>

            {/* Est. Time */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-gray-500">
                <span className="opacity-70">🕒</span>
                <span>Est. Time</span>
              </div>
              <div className="font-medium text-gray-700">
                ~{quote.estimatedFillTimeSec} secs
              </div>
            </div>

            {/* Fees Section */}
            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-gray-500">
                  <span className="opacity-70">💰</span>
                  <span>Total Fee</span>
                </div>
                <div className="font-bold text-gray-800">
                  {formatUnits(BigInt(quote.relayFeeTotal), tokenDecimals)} {token}
                </div>
              </div>

              {/* Nested Fees */}
              <div className="pl-6 space-y-2 border-l border-gray-200 ml-2.5">
                <div className="flex justify-between items-center relative">
                  <div className="absolute -left-[19px] top-1/2 w-3 border-t border-gray-200"></div>
                  <span className="text-gray-400 text-xs">Bridge Fee</span>
                  <span className="text-gray-600 text-xs font-medium">
                    {formatUnits(BigInt(quote.relayerGasFee.total), tokenDecimals)} {token}
                  </span>
                </div>
                <div className="flex justify-between items-center relative">
                  <div className="absolute -left-[19px] top-1/2 w-3 border-t border-gray-200"></div>
                  <span className="text-gray-400 text-xs">Swap Impact</span>
                  <span className="text-gray-600 text-xs font-medium">
                    {formatUnits(BigInt(quote.relayerCapitalFee.total), tokenDecimals)} {token}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ... error/status messages ... */}

        {isPaused && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} /> Ten Bridge is paused.
          </div>
        )}

        {/* {isWhitelisted === false && (
          <div className="p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} /> Token not whitelisted.
          </div>
        )} */}

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
          disabled={loading || (!needsConnect && !needsSwitch && (!quote || !targetL2Address)) || isPaused /* || isWhitelisted === false */}
          className={`w-full py-4 font-bold rounded-lg transition-colors flex items-center justify-center gap-2
            ${needsSwitch 
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
