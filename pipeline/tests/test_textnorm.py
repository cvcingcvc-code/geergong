# Tests for pipeline/search/textnorm.py (PHASE 5).
#
# These lock in the two things the detail page depends on:
#   * a source's Markdown never reaches the reader as literal syntax;
#   * normalising twice equals normalising once (descriptions pass through
#     provider hint -> extracted page -> view model).

import json
import os
import unittest

from pipeline.search import textnorm

CORPUS = os.path.join(os.path.dirname(__file__), "fixtures", "textnorm_corpus.json")


class TestSharedCorpus(unittest.TestCase):
    """The corpus is shared with ui_view_model.test.mjs.

    `activity-view.js` mirrors this module (the app also renders legacy and
    localStorage-persisted views that never went through the pipeline), so the
    two must agree exactly. Both sides assert against this one file; a rule
    added to only one of them fails here.
    """

    def test_matches_shared_corpus(self):
        with open(CORPUS, encoding="utf-8") as fh:
            cases = json.load(fh)["cases"]
        self.assertTrue(cases, "corpus must not be empty")
        for case in cases:
            with self.subTest(case["why"]):
                got = textnorm.plain_text(case["input"],
                                         keep_newlines=case["keepNewlines"])
                self.assertEqual(got, case["expected"])


if __name__ == "__main__":
    unittest.main()


class TestPlainText(unittest.TestCase):

    # --- the real-world case ------------------------------------------------

    def test_meetup_bold_is_stripped(self):
        # A Meetup body is Markdown inside Apollo state; the UI must not show
        # the asterisks.
        raw = "**Bringing Dubai AI to Shanghai** 我们每周六 19:30 线下聚会"
        self.assertEqual(
            textnorm.plain_text(raw),
            "Bringing Dubai AI to Shanghai 我们每周六 19:30 线下聚会")

    def test_cjk_adjacent_bold_is_stripped(self):
        # `\w` matches CJK in Python, so a naive boundary guard would refuse to
        # strip here. This is the regression test for that trap.
        self.assertEqual(textnorm.plain_text("我们**每周**聚会"),
                         "我们每周聚会")

    def test_double_escaped_markdown(self):
        # The body arrived escaped in transit; decode + strip yields clean text.
        raw = r"\*\*Bringing Dubai AI\*\*\n我们每周六 19:30 线下聚会"
        self.assertEqual(textnorm.plain_text(raw),
                         "Bringing Dubai AI\n我们每周六 19:30 线下聚会")
        self.assertEqual(textnorm.plain_text(r"\*\*hi\*\*"), "hi")

    def test_escaped_asterisk_that_is_not_markup(self):
        self.assertEqual(textnorm.plain_text(r"5 \* 3"), "5 * 3")

    def test_backslash_n_becomes_a_paragraph_break(self):
        self.assertEqual(textnorm.plain_text(r"第一段\n\n第二段"),
                         "第一段\n\n第二段")

    # --- markup ------------------------------------------------------------

    def test_links_keep_their_text(self):
        self.assertEqual(textnorm.plain_text("报名见 [官网](https://x.test/a) 页面"),
                         "报名见 官网 页面")

    def test_images_are_removed_entirely(self):
        self.assertEqual(textnorm.plain_text("日程 ![图](https://x.test/a.png) 如下"),
                         "日程 如下")

    def test_heading_and_quote_markers(self):
        self.assertEqual(textnorm.plain_text("## 活动介绍"), "活动介绍")
        self.assertEqual(textnorm.plain_text("> 到场请提前 10 分钟"), "到场请提前 10 分钟")

    def test_rule_line_is_dropped(self):
        # A rule is a separator, so it leaves a paragraph break behind.
        self.assertEqual(textnorm.plain_text("上半场\n---\n下半场"), "上半场\n\n下半场")

    def test_code_fence_lines_dropped_content_kept(self):
        self.assertEqual(textnorm.plain_text("```\nnpm run dev\n```"), "npm run dev")
        self.assertEqual(textnorm.plain_text("用 `npm install` 安装"), "用 npm install 安装")

    def test_strikethrough_and_italic(self):
        self.assertEqual(textnorm.plain_text("~~旧时间~~ 新时间"), "旧时间 新时间")
        self.assertEqual(textnorm.plain_text("报名 *免费* 入场"), "报名 免费 入场")

    # --- must NOT be mangled -----------------------------------------------

    def test_multiplication_is_not_emphasis(self):
        self.assertEqual(textnorm.plain_text("票价 5 * 3 = 15 * 2"), "票价 5 * 3 = 15 * 2")

    def test_snake_case_identifier_survives(self):
        self.assertEqual(textnorm.plain_text("调用 get_user_name 方法"),
                         "调用 get_user_name 方法")

    def test_windows_path_escape_survives(self):
        self.assertEqual(textnorm.plain_text(r"素材在 C:\Users\a\img"), r"素材在 C:\Users\a\img")

    def test_plain_chinese_is_untouched(self):
        raw = "Agent Builder 线下聚会：3 个正在做的 Agent 项目现场拆解，之后自由组队交流。"
        self.assertEqual(textnorm.plain_text(raw), raw)

    # --- contract ----------------------------------------------------------

    def test_blank_and_none_stay_missing(self):
        self.assertIsNone(textnorm.plain_text(None))
        self.assertIsNone(textnorm.plain_text(""))
        self.assertIsNone(textnorm.plain_text("   \n  "))
        self.assertIsNone(textnorm.plain_text("**"))

    def test_whitespace_tidied(self):
        self.assertEqual(textnorm.plain_text("  a \t b \n\n\n\n c  "), "a b\n\nc")
        self.assertEqual(textnorm.plain_text("a\nb", keep_newlines=False), "a b")

    def test_limit_is_applied_after_stripping(self):
        out = textnorm.plain_text("**" + "x" * 50 + "**", limit=10)
        self.assertEqual(out, "x" * 10)

    def test_idempotent(self):
        samples = [
            r"\*\*Bringing Dubai AI\*\*\n我们每周六 19:30 线下聚会",
            "## 标题\n**粗体** 和 [链接](https://x.test)\n---\n> 引用",
            "票价 5 * 3 = 15 * 2 与 get_user_name",
            r"素材在 C:\Users\a\img",
            "纯中文描述，没有任何标记。",
        ]
        for raw in samples:
            once = textnorm.plain_text(raw)
            self.assertEqual(textnorm.plain_text(once), once,
                             "not idempotent for %r" % (raw,))


if __name__ == "__main__":
    unittest.main()
