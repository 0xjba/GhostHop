import BridgeUI from "@/components/BridgeUI";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <header className="text-center mb-12">
          <h2 className="text-4xl font-extrabold text-gray-900 mb-4">
            GhostHop Bridge
          </h2>
          <p className="text-lg text-gray-600">
            Secure, one-click gateway to TEN L2 powered by Across V3.
          </p>
        </header>
        
        <BridgeUI />

        <footer className="mt-20 text-center text-gray-400 text-sm">
          <p>Leg 1: Transport via Across • Leg 2: Settlement via GhostHopAdapter</p>
          <p className="mt-2">Testing on Sepolia (Base / Eth)</p>
        </footer>
      </div>
    </main>
  );
}
