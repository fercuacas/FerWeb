CREATE TABLE skill_packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    slug text NOT NULL,
    UNIQUE(project_id, slug)
);

CREATE TABLE skill_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id uuid NOT NULL REFERENCES skill_packages(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version BETWEEN 1 AND 50),
    content jsonb NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    review text NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'approved', 'rejected')),
    UNIQUE(package_id, version),
    UNIQUE(package_id, sha256)
);
