import { Home } from "@/app/_components/home";

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <Home sessionId={decodeURIComponent(sessionId)} />;
}
