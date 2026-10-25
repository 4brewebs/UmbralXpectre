import { createFileRoute } from "@tanstack/react-router";
import { Calibrator } from "@/components/calibrator";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Calibrator />;
}
