Array.prototype.extend = function(array) {
  Array.prototype.push.apply(this, array);
}

angular.module('d3', [])
  .factory('d3Service', ['$document', '$q', '$rootScope',
    function($document, $q, $rootScope) {
      var d = $q.defer();
      function onScriptLoad() {
        // Load client in the browser
        $rootScope.$apply(function() { d.resolve(window.d3); });
      }

      var scriptTag = $document[0].createElement('script');
      scriptTag.type = 'text/javascript';
      scriptTag.async = true;
      scriptTag.src = 'https://cdnjs.cloudflare.com/ajax/libs/d3/3.5.6/d3.min.js';
      scriptTag.onreadystatechange = function () {
        if (this.readyState == 'complete') { onScriptLoad(); }
      }
      scriptTag.onload = onScriptLoad;

      var s = $document[0].getElementsByTagName('body')[0];
      s.appendChild(scriptTag);

      return {
        d3: function() { return d.promise; }
      };
    }
  ]);

angular.module('Enums', [])
  .factory('EnumService', [function() {
    var TreeNodeTypeEnum = {
      maxNode: 'maxNode',
      minNode: 'minNode',
      randNode: 'randNode',
      leafNode: 'leafNode',

      opposite: function(t) {
        if (t == this.maxNode) {
          return this.minNode;
        } else if (t == this.minNode) {
          return this.maxNode;
        }
        return t;
      },
    };

    return {
      TreeNodeTypeEnum: TreeNodeTypeEnum,
    };

  }]);

angular.module('ActionListQueue', [])
  .factory('ActionLQService', [function() {

    function Action(object, key, oldVal, newVal) {
      this.object = object;
      this.key = key;
      this.oldVal = oldVal;
      this.newVal = newVal;
    }
    Action.prototype.apply = function() {
      if (!this.object) { return; }
      this.object[this.key] = this.newVal;
    }
    Action.prototype.reverse = function() {
      if (!this.object) { return; }
      this.object[this.key] = this.oldVal;
    }

    function ActionListQueue() {
      this.inAction = false;
      this.lastAction = -1;
      this.actionListQueue = []
      this.length = 0;
    }
    ActionListQueue.prototype.pushActionList = function(actionList) {
      if (this.inAction) { return false; }
      this.actionListQueue.push(actionList);
      this.length += 1;
      return true;
    }
    ActionListQueue.prototype.extendActionList = function(actionLists) {
      if (this.inAction) { return false; }
      this.actionListQueue.extend(actionLists);
      this.length += actionLists.length;
      return true;
    }
    ActionListQueue.prototype.stepForward = function() {
      if (!this.inAction ||
          this.lastAction == (this.actionListQueue.length - 1)) {
        return false;
      }
      this.lastAction += 1;
      var actionList = this.actionListQueue[this.lastAction];
      var a;
      for (var i = 0; i < actionList.length; i++) {
        a = actionList[i];
        a.apply();
      }
      return true;
    }
    ActionListQueue.prototype.stepBackward = function() {
      if (!this.inAction || this.lastAction == -1) {
        return false;
      }
      var actionList = this.actionListQueue[this.lastAction];
      var a;
      for (var i = 0; i < actionList.length; i++) {
        a = actionList[i];
        a.reverse();
      }
      this.lastAction -= 1;
      return true;
    }
    ActionListQueue.prototype.goToEnd = function() {
      if (!this.inAction) { return; }
      while (this.stepForward()) {}
    }
    ActionListQueue.prototype.goToBeginning = function() {
      if (!this.inAction) { return; }
      while (this.stepBackward()) {}
    }
    ActionListQueue.prototype.play = function() {
      if (!this.inAction) { return; }
      var end = false;
      var time = 300;
      var step = function(aq) {
        var res = aq.stepForward();
        if (res) {
          setTimeout(step.bind(aq));
        }
      };
      step(this);
    }
    ActionListQueue.prototype.pause = function() {
      clearTimeout(this.playTimeout);
    }

    return {
      Action: Action,
      ActionListQueue: ActionListQueue,
    }

  }]);

angular.module('Tree', ['Enums', 'ActionListQueue'])
  .factory('TreeService', ['EnumService', 'ActionLQService', function(EnumService, ActionLQService) {
    var TreeNodeTypeEnum = EnumService.TreeNodeTypeEnum;
    var Action = ActionLQService.Action;
    var ActionListQueue = ActionLQService.ActionListQueue;

    function Tree(rootNode, treeType, depth, branchingFactor) {
      this.rootNode = rootNode;
      this.treeType = treeType;
      this.depth = depth;
      this.branchingFactor = branchingFactor;
      this.mutable = true;
    }
    Tree.generateABTreeRootNode = function(treeType, maxDepth, branchingFactor, minVal, maxVal, rootSeedVal) {
      function generateSubTree(parentNode, nodeType, depth, bFac) {
        var curNode = new TreeNode(nodeType, parentNode, depth, bFac);
        if (depth == maxDepth) {
          curNode.nodeType = TreeNodeTypeEnum.leafNode;
          curNode.value = Math.round(Math.random() * (maxVal - minVal)) - maxVal;
        } else {
          for (var k = 0; k < bFac; k++) {
            curNode.setKthChild(k,
              generateSubTree(
                curNode,
                TreeNodeTypeEnum.opposite(nodeType),
                depth + 1,
                bFac
              )
            );
          }
        }
        return curNode;
      }
      var root = generateSubTree(null, treeType, 1, branchingFactor);
      if (rootSeedVal != null) {
        root.fixedValue = rootSeedVal;
        root.value = rootSeedVal;
      }
      return root;
    }
    Tree.prototype.alphaBeta = function() {
      var thisTree = this;
      var generatePruneActionList = function(node, bFac) {
        actions = [];
        var pruneInner = function(node, bFac, actions) {
          if (!node) { return; }

          if (node.edgeToParent) {
            actions.push(new Action(node.edgeToParent, 'pruned', false, true));
            node.edgeToParent.__pruned = true;
          }
          var child;
          for (var k = 0; k < bFac; k++) {
            child = node.getKthChild(k);
            pruneInner(child, bFac, actions);
          }
        }
        pruneInner(node, bFac, actions);
        return actions;
      }

      var abActions = function(node, bFac, a, b, maxNode, actionLQ, rootSeedVal) {
        var enterActions = [
          new Action(node.edgeToParent, 'entered', false, true),
          new Action(node, 'entered', false, true),
        ];
        var childActionsList = [];

        if (node.nodeType == TreeNodeTypeEnum.leafNode) {
          return {
            returnVal: node.value,
            enterActions: enterActions,
            childActionsList: childActionsList,
            exitActions: [new Action(node.edgeToParent, 'entered', true, false)],
          };
        }

        enterActions.extend([
          new Action(node, 'alpha', node.alpha, a),
          new Action(node, 'beta', node.beta, b),
        ]);
        node.__alpha = a;
        node.__beta = b;

        var k = 0,
            pruneRest = false,
            lastChildExitActions = [],
            curVal = (node.depth == 1 && rootSeedVal != null)
              ? rootSeedVal
              : (maxNode ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY),
            child,
            childVal,
            setValActions,
            res;
        if (maxNode) {
          for (; k < bFac; k++) {
            child = node.getKthChild(k);
            if (pruneRest) {
              lastChildExitActions.extend(generatePruneActionList(child, bFac));
              lastChildExitActions.push(
                new Action(node, 'pruned', false, true)
              );
              node.__pruned = true;
            } else {
              res = abActions(child, bFac, a, b, !maxNode, actionLQ, rootSeedVal);
              setValActions = [];
              if (res.returnVal > curVal) {
                curVal = res.returnVal;
                setValActions.push(new Action(node, 'value', node.__value, curVal));
                node.__value = curVal;
              }
              if (res.returnVal > a) {
                a = res.returnVal;
                setValActions.extend([
                  new Action(node, 'alpha', node.__alpha, a),
                ]);
                node.__alpha = a;
              }
              if (res.childActionsList.length) {
                res.exitActions.extend(setValActions);
              } else {
                res.enterActions.extend(setValActions);
              }
              res.enterActions.extend(lastChildExitActions);
              childActionsList.push(res.enterActions);
              childActionsList.extend(res.childActionsList);
              lastChildExitActions = res.exitActions;
              if (b <= a) {
                pruneRest = true;
              }
            }
          }
        } else {
          for (; k < bFac; k++) {
            child = node.getKthChild(k);
            if (pruneRest) {
              lastChildExitActions.extend(generatePruneActionList(child, bFac));
              lastChildExitActions.push(
                new Action(node, 'pruned', false, true)
              );
              node.__pruned = true;
            } else {
              res = abActions(child, bFac, a, b, !maxNode, actionLQ, rootSeedVal);
              setValActions = [];
              if (res.returnVal < curVal) {
                curVal = res.returnVal;
                setValActions.push(new Action(node, 'value', node.__value, curVal));
                node.__value = curVal;
              }
              if (res.returnVal < b) {
                b = res.returnVal;
                setValActions.extend([
                  new Action(node, 'beta', node.__beta, b),
                ]);
                node.__beta = b;
              }
              if (res.childActionsList.length) {
                res.exitActions.extend(setValActions);
              } else {
                res.enterActions.extend(setValActions);
              }
              res.enterActions.extend(lastChildExitActions);
              childActionsList.push(res.enterActions);
              childActionsList.extend(res.childActionsList);
              lastChildExitActions = res.exitActions;
              if (b <= a) {
                pruneRest = true;
              }
            }
          }
        }
        childActionsList.push(lastChildExitActions);
        var exitActions = [
          new Action(node.edgeToParent, 'entered', true, false),
          new Action(node, 'entered', true, false),
        ];

        return {
          returnVal: curVal,
          enterActions: enterActions,
          childActionsList: childActionsList,
          exitActions: exitActions,
        };
      }
      var actionLQ = new ActionListQueue();
      var maxRoot = (this.treeType == TreeNodeTypeEnum.maxNode);
      var rootSeedVal = this.rootNode.fixedValue;
      var initAlpha = Number.NEGATIVE_INFINITY;
      var initBeta = Number.POSITIVE_INFINITY;
      if (rootSeedVal != null) {
        if (maxRoot) {
          initAlpha = rootSeedVal;
        } else {
          initBeta = rootSeedVal;
        }
      }
      var res = abActions(
        this.rootNode,
        this.branchingFactor,
        initAlpha,
        initBeta,
        maxRoot,
        actionLQ,
        rootSeedVal
      );
      actionLQ.pushActionList(res.enterActions);
      actionLQ.extendActionList(res.childActionsList);
      actionLQ.pushActionList(res.exitActions);
      return actionLQ;
    }
    Tree.prototype.checkAnswer = function(checkAB) {
      function checkSubTree(node) {
        if (node.nodeType == TreeNodeTypeEnum.leafNode) { return true; }
        if (node.value != node.__value) {
          return false;
        }
        if (checkAB &&
            (node.alpha != node.__alpha || node.beta != node.__beta)) {
          return false;
        }
        if (node.edgeToParent &&
            node.edgeToParent.__pruned &&
            node.edgeToParent.__pruned != node.edgeToParent.pruned) {
          return false;
        }
        var res = true;
        for (var k = 0; k < node.childNum; k++) {
          res = res && checkSubTree(node.getKthChild(k));
        }
        return res;
      }
      return checkSubTree(this.rootNode);
    }
    Tree.prototype.reset = function() {
      function resetSubTree(node) {
        if (node.edgeToParent) {
          node.edgeToParent.entered = false;
          node.edgeToParent.pruned = false;
        }
        node.entered = false;
        if (node.nodeType == TreeNodeTypeEnum.leafNode) { return; }
        node.value = (node.fixedValue != null) ? node.fixedValue : null;
        node.alpha = null;
        node.beta = null;
        for (var k = 0; k < node.childNum; k++) {
          resetSubTree(node.getKthChild(k));
        }
      }
      resetSubTree(this.rootNode);
    }
    Tree.prototype.setSolution = function() {
      this.alphaBeta();
      function setSolutionForSubTree(node) {
        if (node.edgeToParent) {
          node.edgeToParent.pruned = node.edgeToParent.__pruned;
        }
        if (node.nodeType == TreeNodeTypeEnum.leafNode) { return; }
        node.value = node.__value;
        node.alpha = node.__alpha;
        node.beta = node.__beta;
        node.pruned = node.__pruned;
        for (var k = 0; k < node.childNum; k++) {
          setSolutionForSubTree(node.getKthChild(k));
        }
      }
      setSolutionForSubTree(this.rootNode);
    }


    function TreeNode(nodeType, parentNode, depth, childNum) {
      this.nodeType = nodeType;
      this.setParent(parentNode);
      this.depth = depth;
      this.childNum = childNum;
      this.children = new Array(childNum);
      this.value = null;
      this.fixedValue = null;
    }
    TreeNode.prototype.setKthChild = function(k, child) {
      if (k >= this.childNum) {
        throw 'Error: node only holds ' + k + ' children.'
      }
      this.children[k] = child;
    }
    TreeNode.prototype.getKthChild = function(k) {
      if (k >= this.childNum) {
        throw 'Error: node only holds ' + k + ' children.'
      }
      return this.children[k];
    }
    TreeNode.prototype.setParent = function(parentNode) {
      if (parentNode) {
        this.edgeToParent = new TreeEdge(parentNode, this);
        this.parentNode = parentNode;
      }
    }

    function TreeEdge(source, target) {
      this.source = source;
      this.target = target;
      this.pruned = false;
    }

    return {
      Tree: Tree,
      TreeNode: TreeNode,
      TreeEdge: TreeEdge,
    }

  }]);

angular.module('abTreePractice', ['d3', 'Enums', 'Tree'])
  .controller('MainCtrl', [
      'EnumService',
      'TreeService',
      '$scope',
      '$timeout',
      function(EnumService, TreeService, $scope, $timeout) {
    var TreeNodeTypeEnum = EnumService.TreeNodeTypeEnum;
    var Tree = TreeService.Tree;

    $scope.useAb = true;
    $scope.setUseAb = function(bool) {
      $scope.useAb = bool;
    }
    $scope.maxVal = 20;
    $scope.includeRootSeed = false;
    $scope.setRootSeedEnabled = function(bool) {
      $scope.includeRootSeed = bool;
      $scope.generateRootNode();
    }

    $scope.generateRootNode = function(maxFirst) {
      var rootSeedVal = null;
      if ($scope.includeRootSeed) {
        rootSeedVal = Math.round(Math.random() * ($scope.maxVal * 2)) - $scope.maxVal;
      }
      $scope.tree.rootNode = Tree.generateABTreeRootNode(
        $scope.tree.treeType,
        $scope.tree.depth,
        $scope.tree.branchingFactor,
        -$scope.maxVal,
        $scope.maxVal,
        rootSeedVal
      );
      $scope.actionLQ = null;
      $scope.correct = null;
    };
    $scope.tree = new Tree(null, TreeNodeTypeEnum.maxNode, 4, 3);
    $scope.generateRootNode();

    $scope.incrBranchingFactor = function(incr) {
      $scope.tree.branchingFactor = Math.max(2,
          $scope.tree.branchingFactor + incr);
      $scope.generateRootNode();
    };
    $scope.incrDepth = function(incr) {
      $scope.tree.depth = Math.max(3,
          $scope.tree.depth + incr);
      $scope.generateRootNode();
    };
    $scope.flipMax = function() {
      $scope.tree.treeType = TreeNodeTypeEnum.opposite($scope.tree.treeType);
      $scope.generateRootNode();
    };

    $scope.checkAnswer = function() {
      if (!$scope.actionLQ) {
        $scope.actionLQ = $scope.tree.alphaBeta();
      }
      $scope.correct = $scope.tree.checkAnswer($scope.useAb);
    }
    $scope.correct = null;

    $scope.resetTree = function() {
      $scope.tree.reset();
      $scope.reRender();
    }
    $scope.showSolution = function() {
      $scope.tree.setSolution();
      $scope.reRender();
    }

    $scope.reRender = function() { return; }
    $scope.actionLQ = null;

    $scope.toggleABVisual = function() {
      if (!$scope.actionLQ) {
        $scope.actionLQ = $scope.tree.alphaBeta();
      }
      $scope.resetTree();
      if ($scope.actionLQ.inAction) {
        $scope.actionLQ.goToBeginning();
        $scope.tree.mutable = true;
        $scope.actionLQ.inAction = false;
        return;
      }
      $scope.tree.mutable = false;
      $scope.actionLQ.inAction = true;
      $scope.correct = null;
    }
    $scope.stepBackward = function() {
      var ret = false;
      if ($scope.actionLQ) {
        ret = $scope.actionLQ.stepBackward();
        $scope.reRender();
      }
      return ret;
    }
    $scope.stepForward = function() {
      var ret = false;
      if ($scope.actionLQ) {
        ret = $scope.actionLQ.stepForward();
        $scope.reRender();
      }
      return ret;
    }
    $scope.goToBeginning = function() {
      $scope.actionLQ.goToBeginning();
      $scope.reRender();
    }
    $scope.goToEnd = function() {
      $scope.actionLQ.goToEnd();
      $scope.reRender();
    }

    $scope.timeStep = 850;
    $scope.play = function() {
      var end = false;
      var step = function() {
        var res = $scope.stepForward();
        if (res) {
          $scope.playTimeout = $timeout(step, $scope.timeStep);
        }
      };
      step();
    }
    $scope.pause = function() {
      $timeout.cancel($scope.playTimeout);
    }
    $scope.slider = new Slider('input.slider', {
      reversed: true,
      formatter: function(value) {
        return (value / 1000) + 's per action';
      },
    }).on('slide', function(e) {
      $scope.timeStep = e;
    });

  }])
  .directive('abTree',
      ['EnumService',
       'd3Service',
       '$window',
       '$document',
       function(EnumService, d3Service, $window, $document) {
    var TreeNodeTypeEnum = EnumService.TreeNodeTypeEnum;
    return {
      restrict: 'E',
      scope: {
        tree: '=',
        reRender: '=',
        useAb: '=',
      },
      link: function(scope, element, attrs) {
        angular.element($document).ready(function () {
          var svgMargin = 100,
              topMargin = 100,
              nodeSideLength = 80,
              triNodeHeight = Math.sqrt(Math.pow(nodeSideLength, 2) -
                  Math.pow((nodeSideLength/2), 2)),
              triCenterFromBaseDist = Math.sqrt(
                  Math.pow((nodeSideLength / Math.sqrt(3)), 2) -
                  Math.pow((nodeSideLength / 2),2));

        d3Service.d3().then(function(d3) {
          var svgWidth = 0,
              svgHeight = 0;

          var svg = d3.select(element[0])
            .append('svg');

          scope.onResize = function() {
            var navbarHeight = angular
              .element($document[0].getElementsByClassName('navbar'))[0]
              .offsetHeight;
            svgWidth = $window.innerWidth;
            svgHeight = $window.innerHeight - navbarHeight;
            svg.attr('width', svgWidth)
              .attr('height', svgHeight);
          }
          scope.onResize();

          var lastNodeId = -1;
          scope.renderD3Tree = function() {
            scope.nodes = [];
            scope.links = [];
            var root = scope.tree.rootNode,
                bFac = scope.tree.branchingFactor,
                maxDepth = scope.tree.depth,
                yOffset = (svgHeight - (svgMargin + topMargin)) / (maxDepth - 1);

            var renderD3SubTree = function(curNode, xMin, xMax, nodes, links) {
              if (!curNode) { return; }
              var range = xMax - xMin;
              var newOffset = range / bFac;
              var yPos = topMargin + (yOffset * (curNode.depth - 1));
              var xPos = xMin + (range / 2);

              curNode.id = ++lastNodeId;
              curNode.x = xPos;
              curNode.y = yPos;
              nodes.push(curNode);
              if (curNode.edgeToParent) {
                links.push(curNode.edgeToParent);
              }
              for (var k = 0; k < bFac; k++) {
                var kthChild = curNode.getKthChild(k);
                renderD3SubTree(kthChild,
                                xMin + (newOffset * k),
                                xMin + (newOffset * (k + 1)),
                                nodes,
                                links
                               );
              }
            };
            renderD3SubTree(root, svgMargin, svgWidth - svgMargin,
                scope.nodes, scope.links);
            scope.reRender();
          };

          scope.$watch(function() { return scope.tree.rootNode; },
            scope.renderD3Tree
          );
          scope.$watch('useAb', function() {
            scope.reRender();
          });

          angular.element($window).bind('resize', function() {
            scope.onResize();
            clearTimeout(scope.resizeTimeout);
            scope.resizeTimeout = setTimeout(function() {
              scope.renderD3Tree();
              scope.reRender();
            }, 500);
          });

          // handles to link and node element groups
          var path = svg.append('svg:g').selectAll('path'),
              vertex = svg.append('svg:g').selectAll('g');

          // mouse event vars
          var selectedNode = null,
              mousedownNode = null,
              mousedownField = 'value',
              editField = 'value';

          function queueNodeForEdit(d, field) {
            mousedownNode = d;
            mousedownField = field || 'value';
            d.oldVal = d.value;
            d.oldAlpha = d.alpha;
            d.oldBeta = d.beta;
            d.oldFixedValue = d.fixedValue;
          }

          function fmtBound(val) {
            if (val == null) { return '__'; }
            return val.toString().replace('Infinity', '∞');
          }

          // compute text width for cursor
          function computeTextWidth(text, font) {
            // re-use canvas object for better performance
            var canvas = computeTextWidth.canvas ||
              (computeTextWidth.canvas = $document[0].createElement('canvas'));
            var context = canvas.getContext('2d');
            context.font = font;
            var metrics = context.measureText(text);
            return metrics.width;
          };

          // update graph (called when needed)
          scope.reRender = function() {
            // path (link) group
            path = path.data(scope.links, function(link) {
              return link.source.id + ',' + link.target.id
            });

            // add new links
            var newLinks = path.enter().append('svg:g');
            newLinks.append('svg:path')
              .attr('class', 'link');
            newLinks.append('svg:path')
              .attr('class', 'mouselink')
              .on('mousedown', function(d) {
                if (!scope.tree.mutable) { return; }
                d.pruned = !d.pruned;
                scope.reRender();
              })
              .on('mouseover', function(d) {
                // color target link
                d3.select(this.parentNode).select('path.link')
                  .classed('hover', true);
              })
              .on('mouseout', function(d) {
                // uncolor target link
                d3.select(this.parentNode).select('path.link')
                  .classed('hover', false);
              });

            // remove old links
            path.exit().remove();

            // update existing links
            path.select('path.link')
              .attr('d', function(d) {
                return 'M' + d.source.x + ',' + d.source.y +
                       'L' + d.target.x + ',' + d.target.y;
              })
              .classed('pruned', function(d) { return d.pruned; })
              .classed('entered', function(d) {
                return d.entered;
              });
            path.select('path.mouselink')
              .attr('d', function(d) {
                return 'M' + d.source.x + ',' + d.source.y +
                       'L' + d.target.x + ',' + d.target.y;
              });

            // vertex (node) group
            vertex = vertex.data(scope.nodes, function(d) { return d.id; });

            // add new nodes
            var newNodes = vertex.enter().append('svg:g')
              .classed('node', true)
              .classed('leaf', function(d) {
                return (d.nodeType == TreeNodeTypeEnum.leafNode);
              });
            newNodes.append('svg:path')
              .classed('nodepath', true)
              .each(function(d) {
                d.nodeEle = d3.select(this.parentNode);
              })
              .attr('d', function(d) {
                var s = nodeSideLength;
                if (d.nodeType == TreeNodeTypeEnum.leafNode) {
                  var ns = s / 2.1;
                  var a = (s - ns) / 2;
                  // square leaf nodes
                  return 'M' + a + ',' + -a +
                         'L' + (ns + a) + ',' + -a +
                         'L' + (ns + a) + ',' + (-ns - a) +
                         'L' + a + ',' + (-ns - a) +
                         'L' + a + ',' + -a;
                }
                var h = triNodeHeight;
                // triangular min/max nodes
                return 'M' + 0 + ',' + 0 +
                       'L' + s + ',' + 0 +
                       'L' + (s/2) + ',' + -h +
                       'L' + 0 + ',' + 0;
              })
              .on('mousedown', function(d) {
                // select node
                if (!scope.tree.mutable) { return; }
                queueNodeForEdit(d, 'value');
                scope.reRender();
              });
            // show node IDs and alpha-beta
            newNodes.append('svg:text')
              .attr('class', 'value');
            newNodes.append('svg:rect')
              .attr('class', 'fieldbox alpha-box')
              .on('mousedown', function(d) {
                if (!scope.tree.mutable || d.nodeType == TreeNodeTypeEnum.leafNode) { return; }
                queueNodeForEdit(d, 'alpha');
                scope.reRender();
              });
            newNodes.append('svg:text')
              .attr('class', 'alpha')
              .on('mousedown', function(d) {
                if (!scope.tree.mutable || d.nodeType == TreeNodeTypeEnum.leafNode) { return; }
                queueNodeForEdit(d, 'alpha');
                scope.reRender();
              });
            newNodes.append('svg:rect')
              .attr('class', 'fieldbox beta-box')
              .on('mousedown', function(d) {
                if (!scope.tree.mutable || d.nodeType == TreeNodeTypeEnum.leafNode) { return; }
                queueNodeForEdit(d, 'beta');
                scope.reRender();
              });
            newNodes.append('svg:text')
              .attr('class', 'beta')
              .on('mousedown', function(d) {
                if (!scope.tree.mutable || d.nodeType == TreeNodeTypeEnum.leafNode) { return; }
                queueNodeForEdit(d, 'beta');
                scope.reRender();
              });

            // remove old nodes
            vertex.exit().remove();

            // update existing nodes
            vertex
              .classed('entered', function(d) { return d.entered; })
              .classed('pruned', function(d) { return d.pruned; });
            vertex.select('path.nodepath')
              .attr('transform', function(d) {
                var halfSide = nodeSideLength / 2;
                var t = '', r = '';
                if (d.nodeType == TreeNodeTypeEnum.leafNode) {
                  t = 'translate(' +
                           (d.x - halfSide) + ',' +
                           (d.y + halfSide) + ')';
                  r = '';
                } else if (d.nodeType == TreeNodeTypeEnum.maxNode) {
                  t = 'translate(' +
                           (d.x - halfSide) + ',' +
                           (d.y + triCenterFromBaseDist) + ')';
                } else if (d.nodeType == TreeNodeTypeEnum.minNode) {
                  t = 'translate(' +
                           (d.x + halfSide) + ',' +
                           (d.y - triCenterFromBaseDist) + ')';
                  r = ' rotate(180)';
                }
                return t + r;
              });
            // update existing node values
            vertex.select('text.value')
              .attr('x', function(d) { return d.x })
              .attr('y', function(d) { return d.y + 6; })
              .text(function(d) { return (d.value != null) ? d.value : ''; });
            vertex.select('rect.alpha-box')
              .attr('x', function(d) { return d.x + 38; })
              .attr('y', function(d) { return d.y - 16; })
              .attr('width', 66)
              .attr('height', 17)
              .classed('active-field', function(d) {
                return selectedNode === d && editField == 'alpha';
              })
              .style('display', function(d) {
                return (d.nodeType == TreeNodeTypeEnum.leafNode) ? 'none' : null;
              });
            vertex.select('rect.beta-box')
              .attr('x', function(d) { return d.x + 38; })
              .attr('y', function(d) { return d.y + 4; })
              .attr('width', 66)
              .attr('height', 17)
              .classed('active-field', function(d) {
                return selectedNode === d && editField == 'beta';
              })
              .style('display', function(d) {
                return (d.nodeType == TreeNodeTypeEnum.leafNode || !scope.useAb) ? 'none' : null;
              });
            // update existing alpha-beta values
            vertex.select('text.alpha')
              .attr('x', function(d) { return d.x + 45 })
              .attr('y', function(d) { return d.y - 4; })
              .text(function(d) {
                if (d.nodeType == TreeNodeTypeEnum.leafNode) { return ''; }
                if (!scope.useAb) {
                  var val;
                  if (d.nodeType == TreeNodeTypeEnum.maxNode) {
                    val = '≥ ' + fmtBound(d.beta);
                  } else if (d.nodeType == TreeNodeTypeEnum.minNode) {
                    val = '≤ ' + fmtBound(d.alpha);
                  }
                  return 'c ' + val;
                }
                return 'α: ' + fmtBound(d.alpha);
              });
            vertex.select('text.beta')
              .attr('x', function(d) { return d.x + 45 })
              .attr('y', function(d) { return d.y + 16; })
              .text(function(d) {
                if (d.nodeType == TreeNodeTypeEnum.leafNode || !scope.useAb) { return ''; }
                return 'β: ' + fmtBound(d.beta);
              });
            // update existing cursor
            vertex.select('rect.cursor')
              .attr('x', function(node) {
                var nodeVal;
                if (selectedNode === node && editField == 'alpha') {
                  nodeVal = node.alpha;
                } else if (selectedNode === node && editField == 'beta') {
                  nodeVal = node.beta;
                } else {
                  nodeVal = node.value;
                }
                var valStr = (nodeVal == null) ? '' : nodeVal.toString().replace('Infinity', '∞');
                var subStrLength = computeTextWidth(
                    valStr.substring(0, valCharIndex),
                    '18px Helvetica Neue'
                );
                if (selectedNode === node && editField == 'alpha') {
                  var alphaPrefix = computeTextWidth('α: ', '18px Helvetica Neue');
                  return (node.x + 45) + alphaPrefix + subStrLength;
                } else if (selectedNode === node && editField == 'beta') {
                  var betaPrefix = computeTextWidth('β: ', '18px Helvetica Neue');
                  return (node.x + 45) + betaPrefix + subStrLength;
                }
                var valueText = d3.select(this.parentNode).select('text.value').node();
                var valueTextLength = valueText ? valueText.getComputedTextLength() : 0;
                return node.x + (subStrLength - (valueTextLength / 2));
              })
              .attr('y', function(node) {
                if (selectedNode === node && editField == 'alpha') {
                  return node.y - 15;
                } else if (selectedNode === node && editField == 'beta') {
                  return node.y + 5;
                }
                return node.y - 9;
              });
          };

          // node value editing variables and functions
          var valCharIndex = null,
              cursorRect = null,
              valStr = null;
          function incrValCharIndex() {
            valCharIndex = Math.min(valCharIndex + 1, valStr.length);
          }
          function decrValCharIndex() {
            valCharIndex = Math.max(0, valCharIndex - 1);
          }
          function fieldToString(val) {
            if (val == null) { return ''; }
            return val.toString().replace('Infinity', '∞');
          }
          function parseEditableValue(str) {
            if (str == null) { return null; }
            str = str.toString().trim();
            if (str == '') { return null; }
            if (str == '∞' || str.toLowerCase() == 'inf' || str.toLowerCase() == 'infinity') {
              return Number.POSITIVE_INFINITY;
            }
            if (str == '-∞' || str.toLowerCase() == '-inf' || str.toLowerCase() == '-infinity') {
              return Number.NEGATIVE_INFINITY;
            }
            var newVal = parseFloat(str);
            return isNaN(newVal) ? null : newVal;
          }
          function getEditFieldValue(node) {
            if (editField == 'alpha') { return node.alpha; }
            if (editField == 'beta') { return node.beta; }
            return node.value;
          }
          function setEditFieldValue(node, val) {
            if (editField == 'alpha') {
              node.alpha = val;
              return;
            }
            if (editField == 'beta') {
              node.beta = val;
              return;
            }
            node.value = val;
          }
          function parseAndSetNodeValue() {
            var parsed = parseEditableValue(valStr);
            setEditFieldValue(selectedNode, parsed);
            if (selectedNode.depth == 1 &&
                editField == 'value' &&
                selectedNode.fixedValue != null) {
              selectedNode.fixedValue = parsed;
            }

            valCharIndex = null;
            valStr = null;
            selectedNode = null;
            cursorRect.remove();
            cursorRect = null;
          }
          function discardNodeValueChanges() {
            selectedNode.value = selectedNode.oldVal;
            selectedNode.alpha = selectedNode.oldAlpha;
            selectedNode.beta = selectedNode.oldBeta;
            selectedNode.fixedValue = selectedNode.oldFixedValue;
            valCharIndex = null;
            valStr = null;
            selectedNode = null;
            cursorRect.remove();
            cursorRect = null;
          }

          function svgMouseDown() {
            if (mousedownNode) {
              if (mousedownNode === selectedNode) {
                if (mousedownField !== editField) {
                  var parsedCurrent = parseEditableValue(valStr);
                  setEditFieldValue(selectedNode, parsedCurrent);
                  if (selectedNode.depth == 1 &&
                      editField == 'value' &&
                      selectedNode.fixedValue != null) {
                    selectedNode.fixedValue = parsedCurrent;
                  }
                  editField = mousedownField;
                  mousedownField = 'value';
                  nodeValue = getEditFieldValue(selectedNode);
                  valStr = fieldToString(nodeValue);
                  valCharIndex = valStr.length;
                  scope.reRender();
                }
                return;
              }
              if (selectedNode && (mousedownNode !== selectedNode)) {
                parseAndSetNodeValue();
              }
              selectedNode = mousedownNode;
              mousedownNode = null;
              editField = mousedownField;
              mousedownField = 'value';

              nodeValue = getEditFieldValue(selectedNode);
              valStr = fieldToString(nodeValue);
              valCharIndex = valStr.length;

              cursorRect = selectedNode.nodeEle
                .append('svg:rect')
                .attr('class', 'cursor')
                .attr('height', 16.5)
                .attr('width', 1.5)
                .attr('opacity', 1);

              (function fadeRepeat() {
                if (!cursorRect) { return; }
                cursorRect.transition()
                  .duration(750)
                  .attr('opacity', 0)
                 .transition()
                  .duration(750)
                  .attr('opacity', 1)
                  .each('end', fadeRepeat);
              })();

              scope.reRender();
            }
          }

          // only respond once per keydown
          var lastKeyDown = -1;

          function windowKeyDown() {

            lastKeyDown = d3.event.keyCode;

            // Editing Edge Weights
            if (selectedNode) {
              var nodeVal = getEditFieldValue(selectedNode);
              valStr = fieldToString(nodeVal);

              if ((lastKeyDown > 47 && lastKeyDown < 58) // number keys
                  || lastKeyDown == 189 // minus dash
                  || lastKeyDown == 190) { // decimal point
                var leftSlice = valStr.slice(0, valCharIndex),
                    rightSlice = valStr.slice(valCharIndex, valStr.length),
                    lastKeyDown = (lastKeyDown > 188) ? (lastKeyDown - 144) : lastKeyDown,
                    newNum = String.fromCharCode(lastKeyDown);
                valStr = leftSlice + newNum + rightSlice;
                setEditFieldValue(selectedNode, valStr);
                incrValCharIndex();
              } else if (lastKeyDown == 73 || lastKeyDown == 78 || lastKeyDown == 70) { // i, n, f
                var leftSlice = valStr.slice(0, valCharIndex),
                    rightSlice = valStr.slice(valCharIndex, valStr.length),
                    letter = String.fromCharCode(lastKeyDown).toLowerCase();
                valStr = leftSlice + letter + rightSlice;
                setEditFieldValue(selectedNode, valStr);
                incrValCharIndex();
              } else if (d3.event.key == '∞') { // infinity symbol
                var leftSlice = valStr.slice(0, valCharIndex),
                    rightSlice = valStr.slice(valCharIndex, valStr.length);
                valStr = leftSlice + '∞' + rightSlice;
                setEditFieldValue(selectedNode, valStr);
                incrValCharIndex();
              } else if (lastKeyDown == 8) { // backspace
                d3.event.preventDefault();
                var leftSlice = valStr.slice(0, Math.max(0, valCharIndex - 1)),
                    rightSlice = valStr.slice(valCharIndex, valStr.length);
                valStr = leftSlice + rightSlice;
                setEditFieldValue(selectedNode, valStr);
                decrValCharIndex();
              } else if (lastKeyDown == 37) {  // left arrow
                d3.event.preventDefault();
                decrValCharIndex();
              } else if (lastKeyDown == 39) {  // right arrow
                d3.event.preventDefault();
                incrValCharIndex();
              } else if (lastKeyDown == 13) {  // enter
                parseAndSetNodeValue();
              } else if (lastKeyDown == 27) {  // escape
                discardNodeValueChanges();
              }
              scope.reRender();
              return;
            }
          }

          function windowKeyUp() {
            lastKeyDown = -1;
          }

          svg.on('mousedown', svgMouseDown);
          d3.select(window)
            .on('keydown', windowKeyDown)
            .on('keyup', windowKeyUp)
        });
       });
      },
    };
  }]);
