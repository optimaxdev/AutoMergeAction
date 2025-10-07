async function getRepoRequiredRules(octokit, repoOwner, repo) {
    try {
        // First, try to get branch rulesets (newer approach)
        const rulesetQuery = await octokit.graphql(`query ($owner: String!, $repo: String!) {
            repository(name: $repo, owner: $owner) {
                rulesets(first: 10) {
                    nodes {
                        rules(first: 10) {
                            nodes {
                                type
                                ... on RequiredStatusChecks {
                                    requiredStatusChecks {
                                        context
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }`, {
            owner: repoOwner,
            repo: repo,
        });

        // Extract required status checks from rulesets
        const rulesets = rulesetQuery.repository.rulesets.nodes;
        let requiredStatusChecks = [];
        
        for (const ruleset of rulesets) {
            for (const rule of ruleset.rules.nodes) {
                if (rule.type === 'required_status_checks' && rule.requiredStatusChecks) {
                    requiredStatusChecks.push(...rule.requiredStatusChecks.map(check => check.context));
                }
            }
        }

        if (requiredStatusChecks.length > 0) {
            return {
                type: 'rulesets',
                requiredStatusCheckContexts: requiredStatusChecks
            };
        }
    } catch (error) {
        console.log('Branch rulesets not available or error occurred, falling back to branch protection rules:', error.message);
    }

    // Fallback to branch protection rules (legacy approach)
    try {
        const protectionRules = await octokit.graphql(`query ($owner: String!, $repo: String!) {
            repository(name: $repo, owner: $owner) {
                branchProtectionRules(last: 1) {
                    nodes {
                        requiredStatusCheckContexts
                    }
                }
            }
        }`, {
            owner: repoOwner,
            repo: repo,
        });

        const protectionRule = protectionRules.repository.branchProtectionRules.nodes[0];
        if (protectionRule && protectionRule.requiredStatusCheckContexts.length > 0) {
            return {
                type: 'branch_protection',
                requiredStatusCheckContexts: protectionRule.requiredStatusCheckContexts
            };
        }
    } catch (error) {
        console.log('Error fetching branch protection rules:', error.message);
    }

    // Return empty array if no rules found
    return {
        type: 'none',
        requiredStatusCheckContexts: []
    };
}


export const checkRequiredActions = async (octokit, pullRequest, repoOwner, repo ) => {
    const requiredRules = await getRepoRequiredRules(octokit, repoOwner, repo);
    const commitChecks = pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes;
    const repoRequiredRules = requiredRules.requiredStatusCheckContexts;

    console.log('commitChecks', commitChecks);
    console.log('repoRequiredRules', repoRequiredRules);
    console.log('rules source:', requiredRules.type);

    // If no required rules are found, consider all checks as passing
    if (!repoRequiredRules || repoRequiredRules.length === 0) {
        console.log('No required status checks found');
        return true;
    }

    const statusOfRequiredChecks = commitChecks.map((key) => {
        if (repoRequiredRules.indexOf(key.name) !== -1) return key.conclusion;
    }).filter((elem) => elem !== undefined);

    // Check if all required checks have passed
    const hasFailures = statusOfRequiredChecks.includes('FAILURE');
    const hasAllRequiredChecks = statusOfRequiredChecks.length === repoRequiredRules.length;
    
    console.log('Required checks status:', statusOfRequiredChecks);
    console.log('Has failures:', hasFailures);
    console.log('Has all required checks:', hasAllRequiredChecks);

    return !hasFailures && hasAllRequiredChecks;
}
