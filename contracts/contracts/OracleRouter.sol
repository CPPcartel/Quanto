// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink AggregatorV3 surface — the only part we consume.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/**
 * @title OracleRouter
 * @notice Maps a ticker symbol to its Chainlink feed on Robinhood Chain and
 *         reads prices safely.
 *
 * @dev Every consumer in this system reads prices through here so the
 *      staleness rules live in exactly one place. Three things make an onchain
 *      price read unsafe, and all three are handled:
 *
 *      1. Stale data — Robinhood's tokenized-equity feeds are 24/5 and simply
 *         stop updating when the underlying market closes. `latestRoundData()`
 *         keeps returning the last price, so callers MUST check `updatedAt`.
 *      2. L2 sequencer downtime — if the sequencer has been down, prices may be
 *         arbitrarily stale even though the feed looks healthy.
 *      3. Nonsensical answers — a non-positive price means something is wrong.
 */
contract OracleRouter {
    struct Feed {
        address aggregator;
        /// @dev Max age before a price is rejected, in seconds.
        uint32 maxStaleness;
        /// @dev Equity feeds freeze outside market hours; crypto feeds do not.
        bool alwaysOn;
        bool exists;
    }

    address public owner;

    /// @notice Optional Chainlink L2 sequencer-uptime feed.
    AggregatorV3Interface public sequencerUptimeFeed;

    /// @notice Grace period after the sequencer comes back before trusting prices.
    uint256 public constant SEQUENCER_GRACE_PERIOD = 3600;

    mapping(bytes32 => Feed) private _feeds;
    bytes32[] private _symbols;

    event FeedSet(bytes32 indexed symbol, address aggregator, uint32 maxStaleness, bool alwaysOn);
    event SequencerFeedSet(address feed);
    event OwnerTransferred(address indexed from, address indexed to);

    error NotOwner();
    error UnknownFeed(bytes32 symbol);
    error StalePrice(bytes32 symbol, uint256 updatedAt);
    error InvalidPrice(bytes32 symbol, int256 answer);
    error SequencerDown();
    error GracePeriodNotOver();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address sequencerFeed) {
        owner = msg.sender;
        // Optional: zero disables the check, which is correct on a local chain.
        sequencerUptimeFeed = AggregatorV3Interface(sequencerFeed);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, next);
        owner = next;
    }

    function setSequencerFeed(address feed) external onlyOwner {
        sequencerUptimeFeed = AggregatorV3Interface(feed);
        emit SequencerFeedSet(feed);
    }

    function setFeed(
        bytes32 symbol,
        address aggregator,
        uint32 maxStaleness,
        bool alwaysOn
    ) external onlyOwner {
        if (aggregator == address(0)) revert ZeroAddress();
        if (!_feeds[symbol].exists) _symbols.push(symbol);
        _feeds[symbol] = Feed(aggregator, maxStaleness, alwaysOn, true);
        emit FeedSet(symbol, aggregator, maxStaleness, alwaysOn);
    }

    function feedOf(bytes32 symbol) external view returns (Feed memory) {
        return _feeds[symbol];
    }

    function symbolCount() external view returns (uint256) {
        return _symbols.length;
    }

    function symbolAt(uint256 i) external view returns (bytes32) {
        return _symbols[i];
    }

    /**
     * @notice Read a price, reverting unless it is fresh and sane.
     * @return price     The feed answer.
     * @return decimals_ Feed decimals (8 for every Robinhood feed today).
     * @return updatedAt When the feed last published.
     */
    function readPrice(bytes32 symbol)
        public
        view
        returns (int256 price, uint8 decimals_, uint256 updatedAt)
    {
        Feed memory feed = _feeds[symbol];
        if (!feed.exists) revert UnknownFeed(symbol);

        _checkSequencer();

        AggregatorV3Interface aggregator = AggregatorV3Interface(feed.aggregator);
        (, int256 answer, , uint256 updated, ) = aggregator.latestRoundData();

        if (answer <= 0) revert InvalidPrice(symbol, answer);
        if (block.timestamp - updated > feed.maxStaleness) revert StalePrice(symbol, updated);

        return (answer, aggregator.decimals(), updated);
    }

    /**
     * @notice Non-reverting read, for callers that must tolerate a closed
     *         market rather than fail. This is what game logic should use:
     *         an equity feed being frozen overnight is normal, not an error.
     */
    function tryReadPrice(bytes32 symbol)
        external
        view
        returns (bool ok, int256 price, uint256 updatedAt, bool frozen)
    {
        Feed memory feed = _feeds[symbol];
        if (!feed.exists) return (false, 0, 0, false);

        AggregatorV3Interface aggregator = AggregatorV3Interface(feed.aggregator);
        (, int256 answer, , uint256 updated, ) = aggregator.latestRoundData();

        if (answer <= 0) return (false, 0, updated, false);

        bool isStale = block.timestamp - updated > feed.maxStaleness;
        // A frozen equity feed is expected; a frozen 24/7 feed is a fault.
        if (isStale && feed.alwaysOn) return (false, answer, updated, true);

        return (true, answer, updated, isStale);
    }

    /// @dev Reverts if the L2 sequencer is down or only just recovered.
    function _checkSequencer() internal view {
        if (address(sequencerUptimeFeed) == address(0)) return;

        (, int256 answer, uint256 startedAt, , ) = sequencerUptimeFeed.latestRoundData();
        // 0 == up, 1 == down.
        if (answer != 0) revert SequencerDown();
        if (block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD) revert GracePeriodNotOver();
    }
}
