// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test double for a Chainlink feed. Lets tests freeze a price,
///         backdate it, or make it invalid — the three real-world failure
///         modes OracleRouter has to survive.
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public immutable decimals;

    constructor(int256 answer_, uint8 decimals_) {
        answer = answer_;
        decimals = decimals_;
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    /// @dev Simulate a feed that stopped publishing `age` seconds ago.
    function setStale(uint256 age) external {
        updatedAt = block.timestamp - age;
    }

    function setUpdatedAt(uint256 t) external {
        updatedAt = t;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice Test double for Chainlink's L2 sequencer-uptime feed.
contract MockSequencerFeed {
    int256 public answer; // 0 = up, 1 = down
    uint256 public startedAt;

    constructor(int256 answer_, uint256 startedAt_) {
        answer = answer_;
        startedAt = startedAt_;
    }

    function set(int256 answer_, uint256 startedAt_) external {
        answer = answer_;
        startedAt = startedAt_;
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, startedAt, startedAt, 1);
    }
}
