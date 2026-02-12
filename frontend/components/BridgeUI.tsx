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
import { Loader2, ArrowRightLeft, AlertCircle, X, Wallet, RefreshCw, Settings, ArrowRight, ChevronDown, Check } from 'lucide-react';

// ... rest of imports ...

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

  // Helper to extract clean error code from Across API JSON errors
  const extractAcrossError = (e: unknown): string => {
    if (!(e instanceof Error)) return 'Unknown error';
    if (e.message.includes('Across API Error:') || e.message.includes('Across Solana API Error:')) {
      try {
        const jsonStr = e.message.split('Error: ')[1];
        const errorObj = JSON.parse(jsonStr);
        return errorObj.code || e.message;
      } catch {
        return e.message;
      }
    }
    return e.message;
  };

  // 0. NEW: State for your Custom Selector Modal
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);

  // NEW: Handle closing the selector and opening the specific library modal
  const openEvmModal = () => {
    setIsSelectorOpen(false);
    openConnectModal?.();
  };

  const openSolanaModal = () => {
    setIsSelectorOpen(false);
    setSolanaModalVisible(true);
  };

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
      setError(extractAcrossError(e));
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
        setIsSelectorOpen(true);
        return;
      }
      if (!targetL2Address) {
        setError("Please enter a recipient TEN address.");
        return;
      }
      handleBridgeSolana();
      return;
    }

    if (!isEvmConnected) {
      setIsSelectorOpen(true);
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

    if (!targetL2Address) {
      setError("Please enter a recipient TEN address.");
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
      setError(extractAcrossError(e));
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
      setError(extractAcrossError(e));
    } finally {
      setLoading(false);
    }
  };

  const getButtonText = () => {
    if (loading) return "Processing...";
    if (isPaused) return "Bridge Paused";
    
    if (needsConnect) return "Enter Amount";
    
    if (!isSolanaSource && currentChainId !== sourceChainId) return "Switch Network";
    
    if (!quote) return "Enter Amount";

    if (!targetL2Address) return "Enter Recipient";
    
    if (needsApproval) return `Approve ${token}`;

    return "Bridge Now";
  };

  return (
    <div className="min-h-screen bg-background text-text-primary p-4 md:p-12 font-sans overflow-x-hidden">
      
      {/* 1. Step Indicator */}
      <div className="flex justify-center items-center gap-4 mb-12">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all
              ${step === 1 ? 'bg-primary text-background shadow-[0_0_20px_rgba(245,249,106,0.4)]' : 'bg-surface-elevated text-text-secondary border border-border'}
            `}>
              {step}
            </div>
            {step < 4 && <div className="w-12 h-[1px] bg-border hidden sm:block"></div>}
          </div>
        ))}
      </div>

      {/* 2. Main Bridge Card */}
      <div className="max-w-[760px] mx-auto glass-card p-6 md:p-10 relative overflow-hidden">
        
        {/* Abstract Background Glow */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/5 rounded-full blur-[80px]"></div>
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-secondary/5 rounded-full blur-[80px]"></div>

        {/* --- START: CUSTOM WALLET SELECTOR MODAL --- */}
        {isSelectorOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
            <div className="glass-card p-8 w-full max-w-md relative animate-in fade-in zoom-in duration-200">
              <button 
                onClick={() => setIsSelectorOpen(false)}
                className="absolute top-6 right-6 text-text-secondary hover:text-text-primary transition-colors"
              >
                <X size={20} />
              </button>

              <h3 className="text-2xl font-bold mb-8 text-center">Connect Wallet</h3>
              
              <div className="space-y-4">
                <button 
                  onClick={openEvmModal}
                  className="w-full flex items-center justify-between p-5 glass-panel hover:bg-surface-elevated transition-all group border-border/50"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center">
                      <img src="https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/eth.png" alt="ETH" className="w-7 h-7" />
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-lg">EVM Chains</div>
                      <div className="text-sm text-text-secondary">MetaMask, Rainbow, etc</div>
                    </div>
                  </div>
                </button>

                <button 
                  onClick={openSolanaModal}
                  className="w-full flex items-center justify-between p-5 glass-panel hover:bg-surface-elevated transition-all group border-border/50"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-purple-500/10 rounded-full flex items-center justify-center">
                      <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="SOL" className="w-7 h-7" />
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-lg">Solana</div>
                      <div className="text-sm text-text-secondary">Phantom, Backpack, etc</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
        {/* --- END: CUSTOM WALLET SELECTOR MODAL --- */}

        {/* Card Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-white">Bridge</h1>
          </div>
          
          <div className="flex items-center gap-3 relative z-20">
            <button className="p-2.5 rounded-full glass-panel hover:text-primary transition-colors text-text-secondary bg-surface-elevated/50">
              <RefreshCw size={20} />
            </button>
            <button className="p-2.5 rounded-full glass-panel hover:text-primary transition-colors text-text-secondary bg-surface-elevated/50">
              <Settings size={20} />
            </button>
            {/* Connect Wallet Button */}
            <button 
              onClick={() => setIsSelectorOpen(true)}
              className="px-5 py-2.5 rounded-full glass-panel hover:text-primary transition-colors text-text-secondary bg-surface-elevated/50 font-bold text-sm flex items-center gap-2 cursor-pointer"
            >
              <Wallet size={16} className="pointer-events-none" />
              <span className="pointer-events-none">
                {needsConnect ? (isSolanaSource ? "Connect Solana" : "Connect Wallet") : (isSolanaSource ? `${solanaAddress?.toBase58().slice(0,6)}...${solanaAddress?.toBase58().slice(-4)}` : `${evmAddress?.slice(0,6)}...${evmAddress?.slice(-4)}`)}
              </span>
            </button>
          </div>
        </div>

        {/* Bridge Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
          
          {/* Swap-direction button centered */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 hidden md:block">
            <button className="w-12 h-12 rounded-full glass-card border-border bg-surface flex items-center justify-center text-text-secondary hover:text-primary hover:rotate-180 transition-all duration-500 shadow-xl">
              <ArrowRightLeft size={20} />
            </button>
          </div>

          {/* From Panel */}
          <div className="glass-panel p-6 flex flex-col gap-6">
            <div className="flex justify-between items-center text-[10px] text-text-secondary font-bold uppercase tracking-widest opacity-70">
              <span>From</span>
              <div className="flex items-center gap-1.5 text-text-primary truncate max-w-[150px]">
                <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></div>
                {isEvmConnected ? `${evmAddress?.slice(0,6)}...${evmAddress?.slice(-4)}` : (isSolanaConnected ? `${solanaAddress?.toBase58().slice(0,6)}...${solanaAddress?.toBase58().slice(-4)}` : 'Disconnected')}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-[10px] text-text-secondary font-bold uppercase tracking-widest opacity-70">Token</span>
                <div className="flex items-center gap-2 cursor-pointer group relative">
                  <div className="w-7 h-7 rounded-full bg-surface-elevated/50 flex items-center justify-center p-1.5 transition-all">
                    <img 
                      src={token === 'ETH' ? "https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/eth.png" : "https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png"} 
                      alt={token} 
                      className="w-full h-full" 
                    />
                  </div>
                  <div className="relative flex items-center">
                    <select 
                      value={token}
                      onChange={(e) => {
                        const val = e.target.value as 'USDC' | 'ETH';
                        setToken(val);
                        setDestToken(val);
                      }}
                      className="bg-transparent text-lg font-bold outline-none appearance-none pr-6 cursor-pointer"
                    >
                      <option value="USDC">USDC</option>
                      <option value="ETH" disabled={isSolanaSource}>ETH</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-0 text-text-secondary pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="text-text-secondary/20 text-xl font-light self-end pb-1.5">/</div>

              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-[10px] text-text-secondary font-bold uppercase tracking-widest opacity-70">Network</span>
                <div className="flex items-center gap-2 cursor-pointer group relative">
                   <div className="w-7 h-7 rounded-full bg-surface-elevated/50 flex items-center justify-center p-1.5 transition-all">
                    <img 
                      src={sourceChainId === CHAIN_IDS.SOLANA_DEVNET ? "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" : "https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/eth.png"} 
                      alt="network" 
                      className="w-full h-full" 
                    />
                  </div>
                  <div className="relative flex items-center">
                    <select 
                      value={sourceChainId}
                      onChange={(e) => setSourceChainId(Number(e.target.value))}
                      className="bg-transparent text-lg font-bold outline-none appearance-none pr-6 cursor-pointer"
                    >
                      <option value={CHAIN_IDS.BASE_SEPOLIA}>Base</option>
                      <option value={CHAIN_IDS.ARBITRUM_SEPOLIA}>Arbitrum</option>
                      <option value={CHAIN_IDS.SOLANA_DEVNET}>Solana</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-0 text-text-secondary pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest opacity-70">You send</label>
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 bg-transparent text-4xl md:text-5xl font-bold outline-none placeholder:text-text-secondary/20"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-text-secondary">~${amount ? (Number(amount) * (token === 'ETH' ? 2500 : 1)).toFixed(2) : '0.00'}</span>
              <div className="flex items-center gap-2">
                <span className="text-text-secondary">Balance: 0.00</span>
                <button className="text-primary font-bold hover:brightness-110">MAX</button>
              </div>
            </div>
          </div>

          {/* To Panel */}
          <div className="glass-panel p-6 flex flex-col gap-6">
            <div className="flex justify-between items-center text-[10px] text-text-secondary font-bold uppercase tracking-widest opacity-70">
              <span>To</span>
              <div className="flex items-center gap-2 text-text-primary bg-background/50 px-3 py-1.5 rounded-lg transition-all flex-1 ml-4 max-w-[240px]">
                <div className="w-1.5 h-1.5 rounded-full bg-secondary shrink-0"></div>
                <input
                  type="text"
                  value={targetL2Address}
                  onChange={(e) => setTargetL2Address(e.target.value)}
                  className="bg-transparent outline-none font-mono text-[10px] w-full placeholder:text-text-secondary/50"
                  placeholder="Recipient TEN Address (0x...)"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-[10px] text-text-secondary font-bold uppercase tracking-widest opacity-70">Token</span>
                <div className="flex items-center gap-2 opacity-80 group relative">
                  <div className="w-7 h-7 rounded-full bg-surface-elevated/50 flex items-center justify-center p-1.5 transition-all">
                    <img 
                      src={destToken === 'ETH' ? "https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/eth.png" : "https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png"} 
                      alt={destToken} 
                      className="w-full h-full" 
                    />
                  </div>
                  <span className="text-lg font-bold">{destToken}</span>
                </div>
              </div>

              <div className="text-text-secondary/20 text-xl font-light self-end pb-1.5">/</div>

              <div className="flex flex-col gap-1.5 flex-1">
                <span className="text-[10px] text-text-secondary font-bold uppercase tracking-widest opacity-70">Network</span>
                <div className="flex items-center gap-2 opacity-80 group relative">
                   <div className="w-7 h-7 rounded-full bg-surface-elevated/50 flex items-center justify-center p-1.5 transition-all">
                    <img 
                      src="https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/eth.png" 
                      alt="network" 
                      className="w-full h-full" 
                    />
                  </div>
                  <span className="text-lg font-bold">TEN</span>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest opacity-70">You receive</label>
              <div className="flex items-center gap-4">
                <div className={`flex-1 text-4xl md:text-5xl font-bold truncate transition-all ${quote ? 'text-text-primary' : 'text-text-secondary/20'}`}>
                  {quote ? formatUnits(BigInt(quote.outputAmount), destToken === 'USDC' ? 6 : 18) : '0.00'}
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-text-secondary">~${quote ? (Number(formatUnits(BigInt(quote.outputAmount), destToken === 'USDC' ? 6 : 18)) * (destToken === 'ETH' ? 2500 : 1)).toFixed(2) : '0.00'}</span>
              <span className="text-text-secondary">Balance: 0.00</span>
            </div>
          </div>
        </div>

        {/* Quote Details (Optional but Premium) */}
        {quote && (
          <div className="mt-6 p-5 glass-panel border-secondary/20 bg-secondary/5 space-y-3 text-sm animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-text-secondary">
                <ArrowRightLeft size={14} className="text-secondary" />
                <span>Best Route via Across V4</span>
              </div>
              <div className="text-secondary font-bold flex items-center gap-1">
                <Check size={14} />
                Selected
              </div>
            </div>
            
            <div className="h-[1px] bg-border/50"></div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-[10px] text-text-secondary uppercase font-bold">Est. Time</span>
                <div className="font-semibold text-text-primary flex items-center gap-1.5">
                  <RefreshCw size={12} className="animate-spin text-secondary" />
                  ~{quote.estimatedFillTimeSec} seconds
                </div>
              </div>
              <div className="space-y-1 text-right">
                <span className="text-[10px] text-text-secondary uppercase font-bold">Total Fees</span>
                <div className="font-semibold text-text-primary">
                  {formatUnits(BigInt(quote.relayFeeTotal), tokenDecimals)} {token}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error/Status Messages */}
        <div className="mt-6 space-y-3">
          {isPaused && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm flex items-center gap-3">
              <AlertCircle size={18} /> 
              <span className="font-medium">Ten Bridge is currently paused for maintenance.</span>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs break-all font-mono">
              <span className="font-bold uppercase block mb-1">Error Occurred</span>
              {error}
            </div>
          )}
        </div>

        {/* CTA Row */}
        <div className="mt-10 flex justify-end">
          <button
            onClick={handleAction}
            disabled={loading || isPaused}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-bold text-base transition-all overflow-hidden
              !bg-[#F5F96A] !text-[#0B0E11] shadow-[0_4px_30px_rgba(245,249,106,0.3)]
              disabled:opacity-50 disabled:cursor-not-allowed
              hover:brightness-110 active:scale-[0.98]
              relative z-10
            `}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <>
                {getButtonText()}
                <ArrowRight className="group-hover:translate-x-1 transition-transform" size={20} />
              </>
            )}
            
            {/* Inner Glow Effect */}
            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </button>
        </div>

      </div>

      <style jsx>{`
        select {
          -webkit-appearance: none;
          -moz-appearance: none;
          appearance: none;
          background-color: transparent;
        }
        select::-ms-expand {
          display: none;
        }
        option {
          background-color: #1C222B;
          color: white;
        }
      `}</style>
    </div>
  );
}
