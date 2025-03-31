import HedgeFundAnalysis from "@/components/HedgeFundAnalysis";

export default function Home() {
  return (
    <div className="container mx-auto flex flex-col justify-center items-center min-h-screen py-8 px-4 sm:px-8">
      <main className="w-full">
        <HedgeFundAnalysis />
      </main>
    </div>
  );
}
