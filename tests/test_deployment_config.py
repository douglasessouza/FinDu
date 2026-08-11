import re
from pathlib import Path


NGINX_CONFIG = Path("nginx.conf").read_text()
DEPLOY_WORKFLOW = Path(".github/workflows/deploy.yml").read_text()


def _nginx_location(pattern: str) -> str:
    match = re.search(
        rf"^\s*location\s+{pattern}\s*\{{(?P<body>.*?)^\s*\}}",
        NGINX_CONFIG,
        flags=re.MULTILINE | re.DOTALL,
    )
    assert match is not None, f"missing Nginx location matching {pattern!r}"
    return match.group("body")


def _workflow_steps() -> list[tuple[str, str]]:
    matches = list(
        re.finditer(r"^      - name:\s*(?P<name>.+?)\s*$", DEPLOY_WORKFLOW, re.MULTILINE)
    )
    return [
        (
            match.group("name"),
            DEPLOY_WORKFLOW[
                match.start() : matches[index + 1].start()
                if index + 1 < len(matches)
                else len(DEPLOY_WORKFLOW)
            ],
        )
        for index, match in enumerate(matches)
    ]


def _workflow_step(name: str) -> str:
    steps = dict(_workflow_steps())
    assert name in steps, f"missing workflow step {name!r}"
    return steps[name]


def _run_command(step: str) -> str:
    match = re.search(
        r"^        run:\s*\|\s*$(?P<command>.*)",
        step,
        flags=re.MULTILINE | re.DOTALL,
    )
    assert match is not None, "workflow step does not contain a run block"
    return match.group("command")


def test_nginx_caches_hashed_assets_for_one_year_as_immutable():
    assets = _nginx_location(r"/assets/")

    assert re.search(r"\btry_files\s+\$uri\s+=404\s*;", assets)
    cache_control = re.search(
        r'add_header\s+Cache-Control\s+"(?P<value>[^"]+)"', assets
    )
    assert cache_control is not None
    directives = {part.strip() for part in cache_control.group("value").split(",")}
    assert {"public", "max-age=31536000", "immutable"} <= directives


def test_nginx_revalidates_index_html_and_keeps_spa_fallback():
    index = _nginx_location(r"=\s*/index\.html")
    fallback = _nginx_location(r"/")

    cache_control = re.search(
        r'add_header\s+Cache-Control\s+"(?P<value>[^"]+)"', index
    )
    assert cache_control is not None
    directives = {part.strip() for part in cache_control.group("value").split(",")}
    assert {"no-cache", "must-revalidate"} <= directives
    assert re.search(r"\btry_files\s+\$uri\s+\$uri/\s+/index\.html\s*;", fallback)


def test_nginx_gzips_frontend_text_assets():
    assert re.search(r"^\s*gzip\s+on\s*;", NGINX_CONFIG, re.MULTILINE)
    gzip_types = re.search(
        r"^\s*gzip_types\s+(?P<types>.*?)\s*;",
        NGINX_CONFIG,
        flags=re.MULTILINE | re.DOTALL,
    )
    assert gzip_types is not None
    configured_types = set(gzip_types.group("types").split())
    assert {
        "text/css",
        "application/javascript",
        "application/json",
        "image/svg+xml",
    } <= configured_types


def test_nginx_api_proxy_preserves_authorization_header():
    api_proxy = _nginx_location(r"/api/")

    assert re.search(
        r"proxy_set_header\s+Authorization\s+\$http_authorization\s*;", api_proxy
    )


def test_alembic_uses_the_exact_built_api_image_before_api_deploy():
    build = _run_command(_workflow_step("Build and push API image"))
    migration = _run_command(_workflow_step("Run database migrations"))
    api_deploy = _run_command(_workflow_step("Deploy API to Cloud Run"))
    step_names = [name for name, _step in _workflow_steps()]

    assert re.search(
        r"^\s*API_IMAGE:\s*"
        r"us-east1-docker\.pkg\.dev/findu23/findu/findu-api:"
        r"\$\{\{\s*github\.sha\s*\}\}\s*$",
        DEPLOY_WORKFLOW,
        flags=re.MULTILINE,
    )
    assert re.search(r'docker build\s+-f\s+Dockerfile\.api\s+-t\s+"\$API_IMAGE"\s+\.', build)
    assert re.search(r'docker push\s+"\$API_IMAGE"', build)
    assert re.search(
        r'docker run\s+--rm\s+--env\s+DATABASE_URL\s+"\$API_IMAGE"\s+'
        r'alembic\s+upgrade\s+head',
        migration,
    )
    assert re.search(r'--image\s+"\$API_IMAGE"', api_deploy)
    assert step_names.index("Run database migrations") < step_names.index(
        "Deploy API to Cloud Run"
    )


def test_migration_receives_database_secret_without_printing_it_and_fails_closed():
    migration_step = _workflow_step("Run database migrations")
    migration_command = _run_command(migration_step)

    assert re.search(
        r"^        env:\s*$\n^          DATABASE_URL:\s*"
        r"\$\{\{\s*secrets\.DATABASE_URL\s*\}\}\s*$",
        migration_step,
        flags=re.MULTILINE,
    )
    assert "secrets.DATABASE_URL" not in migration_command
    assert not re.search(r"\$\{?DATABASE_URL\}?", migration_command)
    assert not re.search(r"\b(echo|printf|set\s+-x)\b", migration_command)
    assert "continue-on-error:" not in migration_step
    assert not re.search(r"\|\||;\s*true\b|\bset\s+\+e\b", migration_command)
    assert "gcloud run jobs" not in migration_command


def test_api_deploy_keeps_one_instance_warm_with_startup_cpu_boost():
    api_deploy = _run_command(_workflow_step("Deploy API to Cloud Run"))

    assert re.search(r"(?:^|\s)--min-instances(?:=|\s+)1(?:\s|$)", api_deploy)
    assert re.search(r"(?:^|\s)--cpu-boost(?:\s|$)", api_deploy)
