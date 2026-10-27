"""Experiment statistics from sufficient statistics (standard library only).

A group's stats come from semantic_layer.stats_sql: n units, and sums of x (numerator), y
(denominator), their squares and cross-product, plus a covariate c when CUPED is used.
"""
import math
from statistics import NormalDist

Z = NormalDist()


def two_sided_p(z):
    return 2 * (1 - Z.cdf(abs(z)))


def moments(s):
    n = s["n"]
    mx, my = s["sx"] / n, s["sy"] / n
    vx = (s["sxx"] - n * mx * mx) / (n - 1)
    vy = (s["syy"] - n * my * my) / (n - 1)
    cxy = (s["sxy"] - n * mx * my) / (n - 1)
    return n, mx, my, vx, vy, cxy


def ratio(s):
    """Ratio of means and its delta-method variance. With y = 1 it reduces to a plain mean."""
    n, mx, my, vx, vy, cxy = moments(s)
    r = mx / my
    var = (vx - 2 * r * cxy + r * r * vy) / (my * my * n)
    return r, var


def compare(sc, st, alpha=0.05):
    """Treatment minus control, with a normal-approximation CI and two-sided p-value."""
    rc, vc = ratio(sc)
    rt, vt = ratio(st)
    diff, se = rt - rc, math.sqrt(vc + vt)
    z = Z.inv_cdf(1 - alpha / 2)
    out = {
        "control": rc, "treatment": rt, "diff": diff, "se": se,
        "ci_low": diff - z * se, "ci_high": diff + z * se, "p_value": two_sided_p(diff / se),
        "n_control": sc["n"], "n_treatment": st["n"],
    }
    if rc > 0:
        # Relative lift rt / rc - 1, delta method on the ratio of two independent estimates.
        rel_se = math.sqrt(vt / rc ** 2 + rt ** 2 * vc / rc ** 4)
        out.update(rel_lift=rt / rc - 1, rel_ci_low=rt / rc - 1 - z * rel_se, rel_ci_high=rt / rc - 1 + z * rel_se)
    return out


def cuped_compare(sc, st, alpha=0.05):
    """CUPED for a per-unit mean (y = 1): subtract theta * (c - mean c), theta pooled across arms.

    The covariate is measured before the test, so the adjustment cannot be moved by the treatment;
    it only removes variance the two arms share.
    """
    n = sc["n"] + st["n"]
    sx, sc_, scc, sxc = (sc[k] + st[k] for k in ("sx", "sc", "scc", "sxc"))
    mx, mc = sx / n, sc_ / n
    theta = ((sxc - n * mx * mc) / (n - 1)) / ((scc - n * mc * mc) / (n - 1))

    def adjusted(s):
        k = s["n"]
        gx, gc = s["sx"] / k, s["sc"] / k
        vx = (s["sxx"] - k * gx * gx) / (k - 1)
        vc = (s["scc"] - k * gc * gc) / (k - 1)
        cxc = (s["sxc"] - k * gx * gc) / (k - 1)
        mean = gx - theta * (gc - mc)
        var = (vx - 2 * theta * cxc + theta * theta * vc) / k
        return mean, var, vx / k

    ac, vc, raw_vc = adjusted(sc)
    at, vt, raw_vt = adjusted(st)
    diff, se = at - ac, math.sqrt(vc + vt)
    z = Z.inv_cdf(1 - alpha / 2)
    return {
        "control": ac, "treatment": at, "diff": diff, "se": se,
        "ci_low": diff - z * se, "ci_high": diff + z * se, "p_value": two_sided_p(diff / se),
        "theta": theta, "variance_reduction": 1 - (vc + vt) / (raw_vc + raw_vt),
        "n_control": sc["n"], "n_treatment": st["n"],
    }


def srm(n_control, n_treatment, expected_share=0.5):
    """Chi-square goodness of fit against the planned split (one degree of freedom)."""
    n = n_control + n_treatment
    ec, et = n * (1 - expected_share), n * expected_share
    chi2 = (n_control - ec) ** 2 / ec + (n_treatment - et) ** 2 / et
    return {"n": n, "control": n_control, "treatment": n_treatment,
            "treatment_share": n_treatment / n, "chi_square": chi2, "p_value": two_sided_p(math.sqrt(chi2))}


def sample_size_per_arm(p, mde, alpha=0.05, power=0.8):
    """Customers per arm to detect an absolute change of mde from baseline proportion p."""
    z = Z.inv_cdf(1 - alpha / 2) + Z.inv_cdf(power)
    return math.ceil(z * z * 2 * p * (1 - p) / mde ** 2)


def mde_per_arm(p, n, alpha=0.05, power=0.8):
    """Smallest absolute change detectable with n customers per arm."""
    z = Z.inv_cdf(1 - alpha / 2) + Z.inv_cdf(power)
    return z * math.sqrt(2 * p * (1 - p) / n)


def holm(p_values):
    """Holm step-down adjusted p-values, same order as the input."""
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    adjusted, running = [0.0] * m, 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * p_values[i]))
        adjusted[i] = running
    return adjusted
