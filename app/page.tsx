import { connection } from 'next/server';
import Dashboard from './components/dashboard';
import { getGithubUrl } from '../lib/server/public-config';

export default async function Home() {
    // Read public configuration at request time, not when the Docker image is built.
    await connection();
    return <Dashboard githubUrl={getGithubUrl()} />;
}
