import SimulationAnalysis from "@/components/SimulationAnalysis";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SimulationPage() {
  return (
    <div className="container mx-auto flex flex-col justify-center items-center min-h-screen py-8 px-4 sm:px-8">
      {/* Navigation Links */}
      <nav className="mb-6 flex gap-4">
          <Link href="/" passHref>
            <Button variant="outline">Stock Analysis</Button>
          </Link>
          <Link href="/simulation" passHref>
             <Button variant="outline">Trading Simulation</Button>
          </Link>
      </nav>
      <main className="w-full">
        <SimulationAnalysis />
      </main>
    </div>
  );
} 