import sys


def _configure_gpt_researcher_runtime():
    try:
        from gpt_researcher_agent.settings import apply_settings, load_settings
        from gpt_researcher_agent.soul_gateway import (
            patch_gpt_researcher_llm_providers,
            patch_gpt_researcher_retriever,
        )

        settings = load_settings()
        apply_settings(settings)
        patch_gpt_researcher_llm_providers()
        patch_gpt_researcher_retriever()
        sys.stderr.write(
            "[GPTResearcher/sitecustomize] applied GPTResearcher settings "
            f"fastLlm={settings['fastLlm']} smartLlm={settings['smartLlm']} "
            f"strategicLlm={settings['strategicLlm']} embedding={settings['embedding']} "
            f"retriever=search_agent searchProvider={settings['searchProvider']} "
            f"reportSource={settings['reportSource']}\n"
        )
    except Exception as error:
        sys.stderr.write(
            "[GPTResearcher/sitecustomize] failed to apply GPTResearcher settings: "
            f"{error}\n"
        )
        raise


_configure_gpt_researcher_runtime()
