import Link from "next/link";

export default function NotFound() {
  return <main className="route-error"><p>404</p><h1>That scene isn&rsquo;t here.</h1><Link className="primary-action" href="/">Return to Post Credits</Link></main>;
}
