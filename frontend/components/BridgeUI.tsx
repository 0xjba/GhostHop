'use client';

import React, { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useReadContract, useChainId } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import { toByteArray } from 'base64-js';
import { parseUnits, formatUnits } from 'viem';
import { 
  getAcrossQuote, 
  encodeGhostHopMessage,
  getAcrossSolanaDepositTx 
} from '../lib/across';
import { ADDRESSES, CHAIN_IDS } from '../constants/addresses';
import { TEN_BRIDGE_ABI, ACROSS_SPOKE_POOL_ABI, ERC20_TOKEN_ROLE, NATIVE_TOKEN_ROLE } from '../constants/abis';
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
  const { address: evmAddress } = useAccount();
  const { publicKey: solanaAddress, signTransaction, connected: isSolanaConnected } = useWallet();
  const { connection } = useConnection();
  const chainId = useChainId();

  const [amount, setAmount] = useState('');
  const [token, setToken] = useState<'USDC' | 'ETH'>('USDC');
  const [targetL2Address, setTargetL2Address] = useState('');
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<AcrossQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSolanaSource = isSolanaConnected && !!solanaAddress;

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

  const handleFetchQuote = async () => {
    if (!amount || isNaN(Number(amount))) return;
    setLoading(true);
    setError(null);
    try {
      const originChainId = isSolanaSource ? CHAIN_IDS.SOLANA_MAINNET : chainId;
      let inputToken = '';
      let outputToken = '';
      let decimals = 18;

      if (token === 'USDC') {
        inputToken = isSolanaSource 
          ? ADDRESSES.USDC.SOLANA_MAINNET 
          : (chainId === CHAIN_IDS.BASE_SEPOLIA ? ADDRESSES.USDC.BASE_SEPOLIA : ADDRESSES.USDC.ETHEREUM_SEPOLIA);
        outputToken = ADDRESSES.USDC.ETHEREUM_SEPOLIA;
        decimals = 6;
      } else {
        if (isSolanaSource) throw new Error("ETH bridge not supported from Solana in this version");
        inputToken = ADDRESSES.NATIVE_ETH;
        outputToken = ADDRESSES.NATIVE_ETH;
        decimals = 18;
      }

      const q = await getAcrossQuote({
        originChainId,
        destinationChainId: CHAIN_IDS.ETHEREUM_SEPOLIA,
        inputToken,
        outputToken,
        amount: parseUnits(amount, decimals).toString(),
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
  }, [amount, chainId, isSolanaSource, token]);

  const { writeContractAsync } = useWriteContract();

  const handleBridge = async () => {
    if (!quote || !targetL2Address) return;
    setLoading(true);
    setError(null);

    try {
      const message = encodeGhostHopMessage(targetL2Address);

      if (isSolanaSource) {
        if (!signTransaction || !solanaAddress) throw new Error("Solana wallet not connected");
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
      } else {
        if (!evmAddress) throw new Error("EVM wallet not connected");
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
      }
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
        <div className="flex flex-col gap-2 items-end">
          <ConnectButton showBalance={false} chainStatus="none" />
          <WalletMultiButton className="!bg-purple-600 !h-8 !text-xs !py-0 !px-4" />
        </div>
      </div>

      <div className="space-y-4">
        <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
          Source: {isSolanaSource ? 'Solana Mainnet' : (chainId === CHAIN_IDS.BASE_SEPOLIA ? 'Base Sepolia' : 'Other EVM Chain')}
        </div>

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
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${token === 'ETH' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'} disabled:opacity-50`}
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
            <AlertCircle size={16} /> Ten Bridge is currently paused.
          </div>
        )}

        {isWhitelisted === false && (
          <div className="p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {token} is not yet whitelisted on TEN Bridge.
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
          onClick={handleBridge}
          disabled={loading || !quote || !targetL2Address || isPaused || isWhitelisted === false}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" /> : <ArrowRightLeft size={20} />}
          Bridge to TEN
        </button>
      </div>
    </div>
  );
}
